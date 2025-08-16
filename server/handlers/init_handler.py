"""Handler for init message type."""

import os
import logging
from typing import Any, Dict
from fastapi import WebSocket

from ..server_vad import ServerRmsVadSegmenter, ServerVadConfig
from ..connection_manager import connection_manager
from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_init(websocket: WebSocket, message: Dict[str, Any], state: Any) -> None:
    """Handle init message type."""
    seq = message.get("seq")
    
    session_id = message.get("sessionId")
    state.session_id = session_id
    fps = message.get("fps")
    sr = message.get("sampleRate") or 16000
    
    logger.info("INIT HANDLER: sessionId='%s' type=%s", session_id, type(session_id))
    
    if isinstance(sr, int) and sr > 0:
        state.sample_rate = sr
        state.vad = ServerRmsVadSegmenter(sample_rate_hz=state.sample_rate, cfg=ServerVadConfig())
    
    # Update connection manager with session ID
    if session_id:
        connection_manager.update_session_id(state.connection_id, session_id)
    
    logger.debug("INIT connection_id=%s session_id=%s fps=%s sr=%s", 
                state.connection_id, state.session_id, fps, state.sample_rate)
    await send_ack(websocket, seq, "init")
    
    # Send capture configuration to client (only capture FPS is exposed to client)
    try:
        capture_fps_env = os.getenv("CAPTURE_FPS", "1")
        capture_fps = int(capture_fps_env) if str(capture_fps_env).isdigit() else 10
        await send_json_safe(websocket, {"type": "config", "captureFps": capture_fps})
    except Exception:
        pass
