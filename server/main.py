import asyncio
import base64
import os
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import tempfile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .server_vad import ServerRmsVadSegmenter, ServerVadConfig
from .media_encoder import encode_segment
from .gemini_client_enhanced import (
    generate_live_audio_response,
    generate_live_multimodal_response,
    generate_video_response,  # Keep for fallback compatibility
    generate_audio_response,  # Keep for fallback compatibility
    generate_image_response,  # Keep for fallback compatibility
    AudioTextResponse,
    save_audio_response,
)


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


@app.get("/audio/{filename}")
async def get_audio_response(filename: str):
    """Serve audio response files."""
    audio_responses_dir = os.getenv("AUDIO_RESPONSES_DIR", "./audio_responses")
    file_path = os.path.join(audio_responses_dir, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    return FileResponse(
        file_path,
        media_type="audio/wav",
        filename=filename
    )


@app.get("/audio-config")
async def get_audio_config():
    """Get current audio response configuration."""
    return JSONResponse(content={
        "audioResponsesEnabled": os.getenv("ENABLE_AUDIO_RESPONSES", "true").lower() == "true",
        "audioResponsesDir": os.getenv("AUDIO_RESPONSES_DIR", "./audio_responses"),
        "geminiLiveModel": "gemini-2.5-flash-preview-native-audio-dialog",
        "supportedModalities": ["TEXT", "AUDIO"]
    })


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
        # Server VAD
        self.sample_rate = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
        self.vad = ServerRmsVadSegmenter(sample_rate_hz=self.sample_rate, cfg=_make_vad_cfg_from_env())
        self.pending_finalizations: List[Dict[str, Any]] = []  # queued segments awaiting transcript
        # Backpressure thresholds
        self.max_frames_buffer = int(os.getenv("MAX_FRAMES_BUFFER", "5000"))
        self.max_audio_chunks = int(os.getenv("MAX_AUDIO_CHUNKS", "5000"))
        # Gemini Live settings (always enabled)
        self.audio_responses_enabled = bool(os.getenv("ENABLE_AUDIO_RESPONSES", "true").lower() == "true")
        self.response_modalities = ["TEXT", "AUDIO"] if self.audio_responses_enabled else ["TEXT"]
        # Audio response storage
        self.audio_responses_dir = os.getenv("AUDIO_RESPONSES_DIR", "./audio_responses")
        os.makedirs(self.audio_responses_dir, exist_ok=True)


async def _send_json_safe(ws: WebSocket, payload: Dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to send WS message: %s", exc)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state = ConnectionState(websocket)
    logger.debug("WS connected: %s", websocket.client)

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
                    state.vad = ServerRmsVadSegmenter(sample_rate_hz=state.sample_rate, cfg=ServerVadConfig())
                logger.debug("INIT session=%s fps=%s sr=%s", state.session_id, fps, state.sample_rate)
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
                        # slice into Server VAD frames of cfg.frame_ms
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
                    ts = float(message.get("tsMs") or 0)
                    text = message.get("text") or ""
                    is_final = bool(message.get("isFinal"))
                    if is_final:
                        state.transcripts.append((ts, text))
                        if len(state.transcripts) > 500:
                            state.transcripts = state.transcripts[-500:]
                        # Echo final transcript to client for UI display
                        await _send_json_safe(websocket, {"type": "transcript", "text": text, "isFinal": True, "tsMs": ts})
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
                if action == "activesessionclosed":
                    # Client ended ACTIVE speaking session (WebSocket remains open)
                    try:
                        # Emit an idle status so the UI can reflect IDLE mode
                        await _send_json_safe(
                            websocket,
                            {"type": "status", "state": "idle"},
                        )
                        # Optionally finalize a short trailing window to capture any residual content
                        now_ms = _latest_ts(state)
                        seg_end = now_ms
                        seg_start = max(0.0, seg_end - 2000.0)
                        asyncio.create_task(
                            _finalize_segment(
                                state,
                                seg_start,
                                seg_end,
                                skip_transcript_wait=False,
                                prefer_inline_image=False,
                            )
                        )
                    except Exception:
                        pass
                    await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "control"})
                elif action == "forcesegmentclose":
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
        logger.debug("WS disconnected: %s", websocket.client)
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

            # Generate unique audio response filename
            import time
            audio_filename = f"response_{int(time.time() * 1000)}_{seg_start_ms:.0f}_{seg_end_ms:.0f}.wav"
            audio_output_path = os.path.join(state.audio_responses_dir, audio_filename)

            # Use Gemini Live for all responses
            gemini_response: AudioTextResponse
            chosen_path = ""
            
            try:
                # Determine the best input method for Gemini Live
                video_path = None
                if result.frame_count > 0:
                    vp = os.path.join(tmpdir, "out.webm")
                    if os.path.exists(vp):
                        video_path = vp

                if prefer_inline_image and frames_window:
                    # Quick image + text response for typed queries
                    last_frame_bytes = frames_window[-1][1]
                    # Use live audio response with image context (simulate by using transcript)
                    gemini_response = await generate_live_audio_response(
                        transcript_text=f"[Image context] {text or 'Analyze this shopping context'}",
                        response_modalities=state.response_modalities,
                        output_audio_path=audio_output_path if state.audio_responses_enabled else None
                    )
                    chosen_path = "live_image+text"
                    
                elif video_path:
                    # Multimodal: video analysis + live audio response
                    gemini_response = await generate_live_multimodal_response(
                        video_path=video_path,
                        transcript_text=text,
                        response_modalities=state.response_modalities,
                        output_audio_path=audio_output_path if state.audio_responses_enabled else None
                    )
                    chosen_path = "live_multimodal"
                    
                elif result.audio_ms > 0 and result.audio_wav_path:
                    # Audio file input with live response
                    gemini_response = await generate_live_audio_response(
                        audio_file_path=result.audio_wav_path,
                        transcript_text=text,
                        response_modalities=state.response_modalities,
                        output_audio_path=audio_output_path if state.audio_responses_enabled else None
                    )
                    chosen_path = "live_audio"
                    
                else:
                    # Text-only with live audio response
                    gemini_response = await generate_live_audio_response(
                        transcript_text=text or "Please provide shopping assistance",
                        response_modalities=state.response_modalities,
                        output_audio_path=audio_output_path if state.audio_responses_enabled else None
                    )
                    chosen_path = "live_text"

            except Exception as live_error:
                logger.warning("Gemini Live failed, using fallback: %s", live_error)
                # Fallback to basic text response
                fallback_text = generate_video_response(video_path if 'video_path' in locals() else None, text)
                gemini_response = AudioTextResponse(text=fallback_text)
                chosen_path = "fallback_text"

            # Prepare response payload
            payload = {
                "type": "segment",
                "segmentStartMs": seg_start_ms,
                "segmentEndMs": seg_end_ms,
                "transcript": text,
                "encoded": result.frame_count > 0,
                "frameCount": result.frame_count,
                "audioMs": result.audio_ms,
                "fps": result.fps,
                "responseText": gemini_response.text,
                "chosenPath": chosen_path,
                "hasAudioResponse": len(gemini_response.audio_data) > 0,
                "audioResponsePath": audio_filename if len(gemini_response.audio_data) > 0 else None,
            }

            logger.info("GEMINI LIVE chosen_path=%s text_len=%d audio_len=%d", 
                       chosen_path, len(gemini_response.text), len(gemini_response.audio_data))

            # Emit final transcript for UI consumption (if any)
            if text:
                await _send_json_safe(state.websocket, {"type": "transcript", "text": text, "isFinal": True, "tsMs": seg_end_ms})
            
            # Send segment info
            await _send_json_safe(state.websocket, payload)
            
            # Send text response
            if gemini_response.text:
                await _send_json_safe(state.websocket, {"type": "response", "text": gemini_response.text})
            
            # Send audio response if available
            if gemini_response.audio_data and state.audio_responses_enabled:
                import base64
                audio_b64 = base64.b64encode(gemini_response.audio_data).decode()
                await _send_json_safe(state.websocket, {
                    "type": "audio_response",
                    "audioData": audio_b64,
                    "audioFormat": gemini_response.audio_format,
                    "sampleRate": gemini_response.sample_rate,
                    "filename": audio_filename,
                    "segmentStartMs": seg_start_ms,
                    "segmentEndMs": seg_end_ms,
                })

    except Exception as exc:
        # log the concrete error for diagnosis
        logger.exception("SEGMENT FINALIZATION failed in segment [%.1f, %.1f]", seg_start_ms, seg_end_ms)
        
        # Provide error response with basic fallback
        try:
            fallback_response = await generate_live_audio_response(
                transcript_text=text or "I apologize, there was an error processing your request.",
                response_modalities=["TEXT"],  # Text only for error cases
            )
            fallback_text = fallback_response.text
        except Exception:
            fallback_text = "I'm sorry, I encountered an error while processing your request."
        
        await _send_json_safe(state.websocket, {
            "type": "segment",
            "segmentStartMs": seg_start_ms,
            "segmentEndMs": seg_end_ms,
            "transcript": text,
            "encoded": False,
            "error": f"processing_failed:{exc}",
            "responseText": fallback_text,
            "chosenPath": "error_fallback",
        })
        
        if fallback_text:
            await _send_json_safe(state.websocket, {"type": "response", "text": fallback_text})


def _latest_ts(state: ConnectionState) -> float:
    last_audio_ts = 0.0
    if state.audio_chunks:
        ts, _, num, sr = state.audio_chunks[-1]
        last_audio_ts = ts + (num / sr) * 1000.0
    last_frame_ts = state.frames[-1][0] if state.frames else 0.0
    return max(last_audio_ts, last_frame_ts)


def _make_vad_cfg_from_env() -> ServerVadConfig:
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


