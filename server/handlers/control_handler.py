"""Handler for control message type."""

import asyncio
import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_control(websocket: WebSocket, message: Dict[str, Any], state: Any, finalize_segment_func, latest_ts_func) -> None:
    """Handle control message type."""
    seq = message.get("seq")
    action = (message.get("action") or "").lower()
    
    if action == "activesessionclosed":
        # Client ended ACTIVE speaking session (WebSocket remains open)
        try:
            # Emit an idle status so the UI can reflect IDLE mode
            await send_json_safe(
                websocket,
                {"type": "status", "state": "idle"},
            )
            # Optionally finalize a short trailing window to capture any residual content
            now_ms = latest_ts_func(state)
            seg_end = now_ms
            seg_start = max(0.0, seg_end - 2000.0)
            asyncio.create_task(
                finalize_segment_func(
                    state,
                    seg_start,
                    seg_end,
                    skip_transcript_wait=False,
                    prefer_inline_image=False,
                )
            )
        except Exception:
            pass
        await send_ack(websocket, seq, "control")
    elif action == "forcesegmentclose":
        # derive a window from last 2s of audio if available; else last 2s of frames; else ignore
        now_ms = latest_ts_func(state)
        seg_end = now_ms
        seg_start = max(0.0, seg_end - 2000.0)
        await send_json_safe(websocket, {"type": "status", "state": "segment_forced", "segment_start_ms": seg_start, "segment_end_ms": seg_end})
        asyncio.create_task(finalize_segment_func(state, seg_start, seg_end))
    
    await send_ack(websocket, seq, "control")
