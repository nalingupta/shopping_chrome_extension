import asyncio
import base64
import os
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import tempfile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .vad import RmsVadSegmenter, VadConfig
from .media_encoder import encode_segment
from .gemini_client import (
    generate_video_response,
    generate_audio_response,
    generate_image_response,
)


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
        self.sample_rate = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
        self.vad = RmsVadSegmenter(sample_rate_hz=self.sample_rate, cfg=_make_vad_cfg_from_env())
        self.pending_finalizations: List[Dict[str, Any]] = []  # queued segments awaiting transcript
        # Backpressure thresholds
        self.max_frames_buffer = int(os.getenv("MAX_FRAMES_BUFFER", "5000"))
        self.max_audio_chunks = int(os.getenv("MAX_AUDIO_CHUNKS", "5000"))


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
            frames_prev = 0
            audio_prev = 0
            transcripts_prev = 0
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
                # Log a concise ingest summary every 5s
                try:
                    df = state.frames_received - frames_prev
                    da = state.audio_chunks_received - audio_prev
                    dt = state.transcripts_received - transcripts_prev
                    frames_prev = state.frames_received
                    audio_prev = state.audio_chunks_received
                    transcripts_prev = state.transcripts_received
                    rf = df / 5.0
                    ra = da / 5.0
                    logger.info(
                        "INGEST 5s frames=%d (+%d, r=%.1f/s) audio=%d (+%d, r=%.1f/s) transcripts=%d (+%d) buffers: frames_buf=%d audio_buf=%d",
                        state.frames_received,
                        df,
                        rf,
                        state.audio_chunks_received,
                        da,
                        ra,
                        state.transcripts_received,
                        dt,
                        len(state.frames),
                        len(state.audio_chunks),
                    )
                except Exception:
                    pass
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
                    capture_fps_env = os.getenv("CAPTURE_FPS", "1")
                    capture_fps = int(capture_fps_env) if str(capture_fps_env).isdigit() else 10
                    await _send_json_safe(websocket, {"type": "config", "captureFps": capture_fps})
                except Exception:
                    pass
            elif mtype == "imageFrame":
                state.frames_received += 1
                if state.frames_received % 100 == 0:
                    logger.debug("Frames received: %d", state.frames_received)
                try:
                    b64 = message.get("base64")
                    ts = float(message.get("tsMs") or 0)
                    if isinstance(b64, str):
                        jpeg_bytes = base64.b64decode(b64)
                        state.frames.append((ts, jpeg_bytes))
                        # keep last N minutes of frames; simple cap
                        if len(state.frames) > state.max_frames_buffer:
                            # drop oldest and notify busy
                            drop = len(state.frames) - state.max_frames_buffer
                            state.frames = state.frames[drop:]
                            await _send_json_safe(websocket, {"type": "status", "state": "busy", "droppedFrames": drop})
                except Exception as exc:
                    logger.warning("Failed to buffer frame: %s", exc)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "imageFrame"})
            elif mtype == "audioChunk":
                state.audio_chunks_received += 1
                if state.audio_chunks_received % 100 == 0:
                    logger.debug("Audio chunks received: %d", state.audio_chunks_received)
                try:
                    b64 = message.get("base64")
                    ts_start = float(message.get("tsStartMs") or 0)
                    num_samples = int(message.get("numSamples") or 0)
                    sr = int(message.get("sampleRate") or state.sample_rate)
                    if isinstance(b64, str) and num_samples > 0 and sr > 0:
                        pcm_bytes = base64.b64decode(b64)
                        # buffer full chunk for later encoding
                        state.audio_chunks.append((ts_start, pcm_bytes, num_samples, sr))
                        if len(state.audio_chunks) > state.max_audio_chunks:
                            drop = len(state.audio_chunks) - state.max_audio_chunks
                            state.audio_chunks = state.audio_chunks[drop:]
                            await _send_json_safe(websocket, {"type": "status", "state": "busy", "droppedAudioChunks": drop})
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
                # Acknowledge first
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "text"})
                try:
                    text = message.get("text") or ""
                    ts = float(message.get("tsMs") or 0)
                    logger.info("TEXT received tsMs=%.1f len=%d", ts, len(text))
                    # Store as transcript candidate as well
                    state.transcripts.append((ts, text))
                    if len(state.transcripts) > 500:
                        state.transcripts = state.transcripts[-500:]
                    # Immediate typed-only finalize: short window and inline image (last frame) if present
                    now_ms = _latest_ts(state)
                    seg_end = now_ms
                    seg_start = max(0.0, seg_end - 2000.0)
                    asyncio.create_task(
                        _finalize_segment(
                            state,
                            seg_start,
                            seg_end,
                            provided_text=text,
                            skip_transcript_wait=True,
                            prefer_inline_image=True,
                        )
                    )
                except Exception:
                    pass
            elif mtype == "control":
                action = (message.get("action") or "").lower()
                if action == "forcesegmentclose":
                    # derive a window from last 2s of audio if available; else last 2s of frames; else ignore
                    now_ms = _latest_ts(state)
                    seg_end = now_ms
                    seg_start = max(0.0, seg_end - 2000.0)
                    await _send_json_safe(websocket, {"type": "status", "state": "segment_forced", "segment_start_ms": seg_start, "segment_end_ms": seg_end})
                    asyncio.create_task(_finalize_segment(state, seg_start, seg_end))
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "control"})
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


async def _finalize_segment(
    state: ConnectionState,
    seg_start_ms: float,
    seg_end_ms: float,
    provided_text: Optional[str] = None,
    skip_transcript_wait: bool = False,
    prefer_inline_image: bool = False,
) -> None:
    # 1) transcript handling
    if skip_transcript_wait:
        text = provided_text
    else:
        text = await _await_transcript(state, seg_start_ms, seg_end_ms)
    # 2) encode segment (downsampled frames to 2 FPS) using timestamp-synchronized buffers
    try:
        # select frames within window
        frames_window = [(ts, data) for (ts, data) in state.frames if seg_start_ms <= ts <= seg_end_ms]
        audio_window = []
        for (ts, pcm, num, sr) in state.audio_chunks:
            if ts + (num / sr) * 1000.0 >= seg_start_ms and ts <= seg_end_ms:
                audio_window.append((ts, pcm, num, sr))
        logger.info(
            "SEG window [%.1f, %.1f] frames_in=%d audio_chunks_in=%d",
            seg_start_ms,
            seg_end_ms,
            len(frames_window),
            len(audio_window),
        )
        with tempfile.TemporaryDirectory(prefix="seg_") as tmpdir:
            encode_fps = float(os.getenv("ENCODE_FPS", "1.0"))
            result = encode_segment(tmpdir, frames_window, audio_window, seg_start_ms, seg_end_ms, encode_fps=encode_fps)
            logger.info(
                "ENCODE result frame_count=%d audio_ms=%.1f fps=%.2f",
                result.frame_count,
                result.audio_ms,
                result.fps,
            )

            # Typed-only and prefer_inline_image path: send last frame as image + text
            if prefer_inline_image:
                last_frame_bytes = None
                if frames_window:
                    # Use the latest frame in the window
                    last_frame_bytes = frames_window[-1][1]
                gemini_text = generate_image_response(last_frame_bytes, text)
                payload = {
                    "type": "segment",
                    "segmentStartMs": seg_start_ms,
                    "segmentEndMs": seg_end_ms,
                    "transcript": text,
                    "encoded": False,
                    "frameCount": result.frame_count,
                    "audioMs": result.audio_ms,
                    "fps": result.fps,
                    "responseText": gemini_text,
                    "chosenPath": "image+text" if last_frame_bytes else "text",
                }
                logger.info("GEMINI chosen_path=%s preview=%.120s", payload["chosenPath"], (gemini_text or ""))
                await _send_json_safe(state.websocket, payload)
                if gemini_text:
                    await _send_json_safe(state.websocket, {"type": "response", "text": gemini_text})
                return

            # Decide content to send to Gemini per fallback rules:
            # 1) If frames selected > 0 and video muxed, try video + transcript
            # 2) Else if audio present, send audio WAV + transcript
            # 3) Else send transcript only
            video_path = None
            if result.frame_count > 0:
                vp = os.path.join(tmpdir, "out.webm")
                if os.path.exists(vp):
                    video_path = vp

            if video_path:
                gemini_text = generate_video_response(video_path, text)
                encoded = True
                chosen_path = "video+text" if text else "video"
            elif result.audio_ms > 0:
                gemini_text = generate_audio_response(result.audio_wav_path, text)
                encoded = False
                chosen_path = "audio+text" if text else "audio"
            else:
                gemini_text = generate_video_response(None, text)
                encoded = False
                chosen_path = "text"

            payload = {
                "type": "segment",
                "segmentStartMs": seg_start_ms,
                "segmentEndMs": seg_end_ms,
                "transcript": text,
                "encoded": encoded,
                "frameCount": result.frame_count,
                "audioMs": result.audio_ms,
                "fps": result.fps,
                "responseText": gemini_text,
                "chosenPath": chosen_path,
            }
            logger.info("GEMINI chosen_path=%s preview=%.120s", chosen_path, (gemini_text or ""))
            await _send_json_safe(state.websocket, payload)
            # Also emit a response message for UI rendering without client changes
            if gemini_text:
                await _send_json_safe(state.websocket, {"type": "response", "text": gemini_text})
    except Exception as exc:
        # log the concrete ffmpeg/encode failure for diagnosis
        logger.exception("ENCODE failed in segment [%.1f, %.1f]", seg_start_ms, seg_end_ms)
        # provide error plus fallback response if possible
        try:
            gemini_text = generate_video_response(None, text)
        except Exception:
            gemini_text = ""
        await _send_json_safe(state.websocket, {
            "type": "segment",
            "segmentStartMs": seg_start_ms,
            "segmentEndMs": seg_end_ms,
            "transcript": text,
            "encoded": False,
            "error": f"encode_failed:{exc}",
            "responseText": gemini_text,
        })
        if gemini_text:
            await _send_json_safe(state.websocket, {"type": "response", "text": gemini_text})


def _latest_ts(state: ConnectionState) -> float:
    last_audio_ts = 0.0
    if state.audio_chunks:
        ts, _, num, sr = state.audio_chunks[-1]
        last_audio_ts = ts + (num / sr) * 1000.0
    last_frame_ts = state.frames[-1][0] if state.frames else 0.0
    return max(last_audio_ts, last_frame_ts)


def _make_vad_cfg_from_env() -> VadConfig:
    try:
        return VadConfig(
            frame_ms=int(os.getenv("VAD_FRAME_MS", "30")),
            min_speech_ms=int(os.getenv("VAD_MIN_SPEECH_MS", "300")),
            end_silence_ms=int(os.getenv("VAD_END_SILENCE_MS", "800")),
            pre_roll_ms=int(os.getenv("VAD_PRE_ROLL_MS", "200")),
            post_roll_ms=int(os.getenv("VAD_POST_ROLL_MS", "300")),
            amplitude_threshold=float(os.getenv("VAD_AMPLITUDE_THRESHOLD", "0.02")),
        )
    except Exception:
        return VadConfig()


