"""Handler for text message type."""

import asyncio
import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_text(websocket: WebSocket, message: Dict[str, Any], state: Any, finalize_segment_func, latest_ts_func) -> None:
    """Handle text message type."""
    seq = message.get("seq")
    
    state.text_msgs_received += 1
    # Acknowledge first
    await send_ack(websocket, seq, "text")
    
    try:
        text = message.get("text") or ""
        ts = float(message.get("tsMs") or 0)
        logger.info("TEXT received tsMs=%.1f len=%d", ts, len(text))
        
        # Store as transcript candidate as well
        state.transcripts.append((ts, text))
        if len(state.transcripts) > 500:
            state.transcripts = state.transcripts[-500:]
        
        # Immediate typed-only finalize: short window and inline image (last frame) if present
        now_ms = latest_ts_func(state)
        seg_end = now_ms
        seg_start = max(0.0, seg_end - 2000.0)
        asyncio.create_task(
            finalize_segment_func(
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
