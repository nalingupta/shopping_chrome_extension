"""Refactored main server with modular message handlers."""

import asyncio
import os
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import tempfile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .server_vad import ServerRmsVadSegmenter, ServerVadConfig
from .media_encoder import encode_segment
from .gemini_client import (
    generate_video_response,
    generate_audio_response,
    generate_image_response,
)
from .handlers import (
    handle_init,
    handle_image_frame,
    handle_audio_chunk,
    handle_transcript,
    handle_text,
    handle_control,
    handle_links,
)
from .handlers.base import send_json_safe
from .connection_manager import connection_manager

logger = logging.getLogger("server")
# Reduce server terminal verbosity by default; keep extension console logs unchanged
_log_level_name = os.getenv("SERVER_LOG_LEVEL", "WARNING").upper()
_log_level = getattr(logging, _log_level_name, logging.WARNING)
logging.basicConfig(level=_log_level, format="[%(asctime)s] %(levelname)s %(message)s")

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


@app.get("/connections")
async def get_connections():
    """Get information about active WebSocket connections."""
    stats = connection_manager.get_stats()
    connections_info = {}
    
    for connection_id in connection_manager.get_connection_ids():
        info = connection_manager.get_connection_info(connection_id)
        connections_info[connection_id] = info
    
    return JSONResponse(content={
        "stats": stats,
        "connections": connections_info
    }, status_code=200)


class ConnectionState:
    def __init__(self, websocket: WebSocket, connection_id: str):
        self.websocket = websocket
        self.connection_id = connection_id
        self.session_id: str | None = None
        self.frames_received: int = 0
        self.audio_chunks_received: int = 0
        self.transcripts_received: int = 0
        self.text_msgs_received: int = 0
        # Buffers
        self.frames: List[Tuple[float, bytes]] = []  # (tsMs, jpegBytes)
        self.audio_chunks: List[Tuple[float, bytes, int, int]] = []  # (tsStartMs, pcm_bytes, num_samples, sample_rate)
        self.transcripts: List[Tuple[float, str]] = []  # (tsMs, text)
        # Server VAD
        self.sample_rate = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
        self.vad = ServerRmsVadSegmenter(sample_rate_hz=self.sample_rate, cfg=_make_vad_cfg_from_env())
        self.pending_finalizations: List[Dict[str, Any]] = []  # queued segments awaiting transcript
        # Backpressure thresholds
        self.max_frames_buffer = int(os.getenv("MAX_FRAMES_BUFFER", "5000"))
        self.max_audio_chunks = int(os.getenv("MAX_AUDIO_CHUNKS", "5000"))
        # Product links storage
        # Product links storage
        self.detected_links: List[Tuple[float, str]] = []  # (tsMs, link)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Register connection and get unique ID
    connection_id = connection_manager.connect(websocket)
    state = ConnectionState(websocket, connection_id)
    logger.debug("WS connected: connection_id=%s client=%s", connection_id, websocket.client)

    # Periodic status pings
    async def status_task():
        try:
            frames_prev = 0
            audio_prev = 0
            transcripts_prev = 0
            while True:
                await asyncio.sleep(5)
                await send_json_safe(
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
                    logger.debug(
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

    # Message type handlers mapping
    handlers = {
        "init": lambda msg: handle_init(websocket, msg, state),
        "imageFrame": lambda msg: handle_image_frame(websocket, msg, state),
        "audioChunk": lambda msg: handle_audio_chunk(websocket, msg, state, _finalize_segment),
        "transcript": lambda msg: handle_transcript(websocket, msg, state),
        "text": lambda msg: handle_text(websocket, msg, state, _finalize_segment, _latest_ts),
        "control": lambda msg: handle_control(websocket, msg, state, _finalize_segment, _latest_ts),
        "links": lambda msg: handle_links(websocket, msg, state),
    }

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("WS received invalid JSON: %s", raw[:200])
                await send_json_safe(websocket, {"type": "error", "message": "invalid_json"})
                continue

            mtype = message.get("type")
            seq = message.get("seq")
            
            # Debug logging for init messages
            if mtype == "init":
                logger.info("Received init message: %s", json.dumps(message, indent=2))
            
            # Log only unknown/unexpected WebSocket events
            if mtype not in handlers:
                logger.info("WS EVENT (UNKNOWN): %s seq=%s data=%s", mtype, seq, str(message)[:200])
                await send_json_safe(websocket, {"type": "error", "message": f"unknown_type:{mtype}"})
                continue

            # Route to appropriate handler
            try:
                await handlers[mtype](message)
            except Exception as exc:
                logger.exception("Handler error for %s: %s", mtype, exc)
                await send_json_safe(websocket, {"type": "error", "message": f"handler_error:{mtype}"})

    except WebSocketDisconnect:
        logger.debug("WS disconnected: connection_id=%s client=%s", connection_id, websocket.client)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WS error: connection_id=%s error=%s", connection_id, exc)
    finally:
        status_bg.cancel()
        # Clean up connection
        connection_manager.disconnect(connection_id)


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
    """Finalize a segment by encoding and sending to Gemini."""
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
                # Emit final transcript for UI consumption (if any)
                if text:
                    await send_json_safe(state.websocket, {"type": "transcript", "text": text, "isFinal": True, "tsMs": seg_end_ms})
                await send_json_safe(state.websocket, payload)
                if gemini_text:
                    await send_json_safe(state.websocket, {"type": "response", "text": gemini_text})
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
            # Emit final transcript for UI consumption (if any)
            if text:
                await send_json_safe(state.websocket, {"type": "transcript", "text": text, "isFinal": True, "tsMs": seg_end_ms})
            await send_json_safe(state.websocket, payload)
            # Also emit a response message for UI rendering without client changes
            if gemini_text:
                await send_json_safe(state.websocket, {"type": "response", "text": gemini_text})
    except Exception as exc:
        # log the concrete ffmpeg/encode failure for diagnosis
        logger.exception("ENCODE failed in segment [%.1f, %.1f]", seg_start_ms, seg_end_ms)
        # provide error plus fallback response if possible
        try:
            gemini_text = generate_video_response(None, text)
        except Exception:
            gemini_text = ""
        await send_json_safe(state.websocket, {
            "type": "segment",
            "segmentStartMs": seg_start_ms,
            "segmentEndMs": seg_end_ms,
            "transcript": text,
            "encoded": False,
            "error": f"encode_failed:{exc}",
            "responseText": gemini_text,
        })
        if gemini_text:
            await send_json_safe(state.websocket, {"type": "response", "text": gemini_text})


def _latest_ts(state: ConnectionState) -> float:
    """Get the latest timestamp from audio or frame buffers."""
    last_audio_ts = 0.0
    if state.audio_chunks:
        ts, _, num, sr = state.audio_chunks[-1]
        last_audio_ts = ts + (num / sr) * 1000.0
    last_frame_ts = state.frames[-1][0] if state.frames else 0.0
    return max(last_audio_ts, last_frame_ts)


def _make_vad_cfg_from_env() -> ServerVadConfig:
    """Create VAD configuration from environment variables."""
    try:
        return ServerVadConfig(
            frame_ms=int(os.getenv("VAD_FRAME_MS", "30")),
            min_speech_ms=int(os.getenv("VAD_MIN_SPEECH_MS", "300")),
            end_silence_ms=int(os.getenv("VAD_END_SILENCE_MS", "800")),
            pre_roll_ms=int(os.getenv("VAD_PRE_ROLL_MS", "200")),
            post_roll_ms=int(os.getenv("VAD_POST_ROLL_MS", "300")),
            amplitude_threshold=float(os.getenv("VAD_AMPLITUDE_THRESHOLD", "0.02")),
        )
    except Exception:
        return ServerVadConfig()
