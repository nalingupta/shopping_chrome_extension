"""Handler for imageFrame message type."""

import base64
import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_image_frame(websocket: WebSocket, message: Dict[str, Any], state: Any) -> None:
    """Handle imageFrame message type."""
    seq = message.get("seq")
    
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
                await send_json_safe(websocket, {"type": "status", "state": "busy", "droppedFrames": drop})
    except Exception as exc:
        logger.warning("Failed to buffer frame: %s", exc)
    
    await send_ack(websocket, seq, "imageFrame")
