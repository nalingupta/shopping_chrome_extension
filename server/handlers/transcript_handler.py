"""Handler for transcript message type."""

import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_transcript(websocket: WebSocket, message: Dict[str, Any], state: Any) -> None:
    """Handle transcript message type."""
    seq = message.get("seq")
    
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
            await send_json_safe(websocket, {"type": "transcript", "text": text, "isFinal": True, "tsMs": ts})
    except Exception:
        pass
    
    await send_ack(websocket, seq, "transcript")
