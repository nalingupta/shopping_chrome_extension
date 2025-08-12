import asyncio
import base64
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import tempfile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .vad import RmsVadSegmenter, VadConfig
from .media_encoder import encode_segment


logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")

app = FastAPI(title="Shopping Extension Backend", version="0.1.0")

# Allow local development from extension and localhost tools
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return JSONResponse(content={"status": "ok"}, status_code=200)


class ConnectionState:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.session_id: str | None = None
        self.frames_received: int = 0
        self.audio_chunks_received: int = 0
        self.transcripts_received: int = 0
        self.text_msgs_received: int = 0
        # Buffers
        self.frames: List[Tuple[float, bytes]] = []  # (tsMs, jpegBytes)
        self.audio_chunks: List[Tuple[float, bytes, int, int]] = []  # (tsStartMs, pcm_bytes, num_samples, sample_rate)
        self.transcripts: List[Tuple[float, str]] = []  # (tsMs, text)
        # VAD
        self.sample_rate = 16000
        self.vad = RmsVadSegmenter(sample_rate_hz=self.sample_rate, cfg=VadConfig())
        self.pending_finalizations: List[Dict[str, Any]] = []  # queued segments awaiting transcript


async def _send_json_safe(ws: WebSocket, payload: Dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to send WS message: %s", exc)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state = ConnectionState(websocket)
    logger.info("WS connected: %s", websocket.client)

    # Periodic status pings
    async def status_task():
        try:
            while True:
                await asyncio.sleep(5)
                await _send_json_safe(
                    websocket,
                    {
                        "type": "status",
                        "state": "ready",
                        "frames": state.frames_received,
                        "audio": state.audio_chunks_received,
                        "transcripts": state.transcripts_received,
                        "text": state.text_msgs_received,
                    },
                )
        except Exception:
            # Task ends when connection closes
            return

    status_bg = asyncio.create_task(status_task())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json_safe(websocket, {"type": "error", "message": "invalid_json"})
                continue

            mtype = message.get("type")
            seq = message.get("seq")

            if mtype == "init":
                state.session_id = message.get("sessionId")
                fps = message.get("fps")
                sr = message.get("sampleRate") or 16000
                if isinstance(sr, int) and sr > 0:
                    state.sample_rate = sr
                    state.vad = RmsVadSegmenter(sample_rate_hz=state.sample_rate, cfg=VadConfig())
                logger.info("INIT session=%s fps=%s sr=%s", state.session_id, fps, state.sample_rate)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "init"})
                # Send capture configuration to client (only capture FPS is exposed to client)
                try:
                    capture_fps = 10  # configurable server-side default
                    await _send_json_safe(websocket, {"type": "config", "captureFps": capture_fps})
                except Exception:
                    pass
            elif mtype == "imageFrame":
                state.frames_received += 1
                if state.frames_received % 100 == 0:
                    logger.info("Frames received: %d", state.frames_received)
                try:
                    b64 = message.get("base64")
                    ts = float(message.get("tsMs") or 0)
                    if isinstance(b64, str):
                        jpeg_bytes = base64.b64decode(b64)
                        state.frames.append((ts, jpeg_bytes))
                        # keep last N minutes of frames; simple cap
                        if len(state.frames) > 20000:
                            state.frames = state.frames[-20000:]
                except Exception as exc:
                    logger.warning("Failed to buffer frame: %s", exc)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "imageFrame"})
            elif mtype == "audioChunk":
                state.audio_chunks_received += 1
                if state.audio_chunks_received % 100 == 0:
                    logger.info("Audio chunks received: %d", state.audio_chunks_received)
                try:
                    b64 = message.get("base64")
                    ts_start = float(message.get("tsStartMs") or 0)
                    num_samples = int(message.get("numSamples") or 0)
                    sr = int(message.get("sampleRate") or state.sample_rate)
                    if isinstance(b64, str) and num_samples > 0 and sr > 0:
                        pcm_bytes = base64.b64decode(b64)
                        # buffer full chunk for later encoding
                        state.audio_chunks.append((ts_start, pcm_bytes, num_samples, sr))
                        if len(state.audio_chunks) > 20000:
                            state.audio_chunks = state.audio_chunks[-20000:]
                        # slice into VAD frames of cfg.frame_ms
                        frame_ms = state.vad.cfg.frame_ms
                        samples_per_frame = int(sr * (frame_ms / 1000))
                        bytes_per_frame = samples_per_frame * 2
                        total_frames = max(1, len(pcm_bytes) // bytes_per_frame)
                        for i in range(total_frames):
                            start = i * bytes_per_frame
                            end = start + bytes_per_frame
                            frame = pcm_bytes[start:end]
                            frame_ts = ts_start + (i * frame_ms)
                            event, payload = state.vad.process_frame(frame, frame_ts)
                            if event == "segment_start":
                                await _send_json_safe(websocket, {"type": "status", "state": "speaking", **payload})
                            elif event == "segment_end":
                                await _send_json_safe(websocket, {"type": "status", "state": "segment_closed", **payload})
                                # schedule transcript wait/finalize + encode
                                asyncio.create_task(_finalize_segment(state, payload["segment_start_ms"], payload["segment_end_ms"]))
                except Exception as exc:
                    logger.warning("Failed to process audio chunk: %s", exc)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "audioChunk"})
            elif mtype == "transcript":
                state.transcripts_received += 1
                try:
                    if message.get("isFinal"):
                        ts = float(message.get("tsMs") or 0)
                        text = message.get("text") or ""
                        state.transcripts.append((ts, text))
                        # cap transcripts
                        if len(state.transcripts) > 500:
                            state.transcripts = state.transcripts[-500:]
                except Exception:
                    pass
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "transcript"})
            elif mtype == "text":
                state.text_msgs_received += 1
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "text"})
            else:
                await _send_json_safe(websocket, {"type": "error", "message": f"unknown_type:{mtype}"})

    except WebSocketDisconnect:
        logger.info("WS disconnected: %s", websocket.client)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WS error: %s", exc)
    finally:
        status_bg.cancel()


async def _await_transcript(state: ConnectionState, seg_start_ms: float, seg_end_ms: float) -> Optional[str]:
    """Wait up to 2s for a final transcript overlapping the segment and return it (or None)."""
    deadline = asyncio.get_event_loop().time() + 2.0
    chosen_text: Optional[str] = None
    # check immediately, then poll
    while True:
        # find overlapping final transcript
        for ts, text in reversed(state.transcripts):
            if (seg_start_ms - 500) <= ts <= (seg_end_ms + 500):
                chosen_text = text
                break
        if chosen_text is not None or asyncio.get_event_loop().time() >= deadline:
            break
        await asyncio.sleep(0.1)
    return chosen_text


async def _finalize_segment(state: ConnectionState, seg_start_ms: float, seg_end_ms: float) -> None:
    # 1) wait for transcript (<=2s)
    text = await _await_transcript(state, seg_start_ms, seg_end_ms)
    # 2) encode segment (downsampled frames to 2 FPS) using timestamp-synchronized buffers
    try:
        # select frames within window
        frames_window = [(ts, data) for (ts, data) in state.frames if seg_start_ms <= ts <= seg_end_ms]
        audio_window = []
        for (ts, pcm, num, sr) in state.audio_chunks:
            if ts + (num / sr) * 1000.0 >= seg_start_ms and ts <= seg_end_ms:
                audio_window.append((ts, pcm, num, sr))
        with tempfile.TemporaryDirectory(prefix="seg_") as tmpdir:
            result = encode_segment(tmpdir, frames_window, audio_window, seg_start_ms, seg_end_ms, encode_fps=2.0)
            # For Phase 4, only report success and basic stats. We will attach the file path in Phase 5 for Gemini.
            payload = {
                "type": "segment",
                "segmentStartMs": seg_start_ms,
                "segmentEndMs": seg_end_ms,
                "transcript": text,
                "encoded": True,
                "frameCount": result.frame_count,
                "audioMs": result.audio_ms,
                "fps": result.fps,
            }
            await _send_json_safe(state.websocket, payload)
    except Exception as exc:
        payload = {
            "type": "segment",
            "segmentStartMs": seg_start_ms,
            "segmentEndMs": seg_end_ms,
            "transcript": text,
            "encoded": False,
            "error": f"encode_failed:{exc}",
        }
        await _send_json_safe(state.websocket, payload)


