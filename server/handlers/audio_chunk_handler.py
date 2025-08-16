"""Handler for audioChunk message type."""

import asyncio
import base64
import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_audio_chunk(websocket: WebSocket, message: Dict[str, Any], state: Any, finalize_segment_func) -> None:
    """Handle audioChunk message type."""
    seq = message.get("seq")
    
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
                await send_json_safe(websocket, {"type": "status", "state": "busy", "droppedAudioChunks": drop})
            
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
                    await send_json_safe(websocket, {"type": "status", "state": "speaking", **payload})
                elif event == "segment_end":
                    await send_json_safe(websocket, {"type": "status", "state": "segment_closed", **payload})
                    # schedule transcript wait/finalize + encode
                    asyncio.create_task(finalize_segment_func(state, payload["segment_start_ms"], payload["segment_end_ms"]))
    except Exception as exc:
        logger.warning("Failed to process audio chunk: %s", exc)
    
    await send_ack(websocket, seq, "audioChunk")
