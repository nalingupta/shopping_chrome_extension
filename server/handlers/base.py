"""Base handler with shared utilities for WebSocket message handlers."""

import json
import logging
from typing import Any, Dict
from fastapi import WebSocket

logger = logging.getLogger("server")


async def send_json_safe(ws: WebSocket, payload: Dict[str, Any]) -> None:
    """Safely send JSON message to WebSocket with proper logging."""
    try:
        # Log outgoing messages with key details
        msg_type = payload.get("type", "unknown")
        if msg_type == "status":
            logger.info("WS SEND: %s state=%s", msg_type, payload.get("state"))
        elif msg_type == "segment":
            logger.info("WS SEND: %s startMs=%.1f endMs=%.1f transcript='%s' chosenPath=%s", 
                       msg_type, payload.get("segmentStartMs", 0), payload.get("segmentEndMs", 0),
                       (payload.get("transcript") or "")[:50], payload.get("chosenPath"))
        elif msg_type == "response":
            logger.info("WS SEND: %s text='%s'", msg_type, (payload.get("text") or "")[:100])
        elif msg_type == "transcript":
            logger.info("WS SEND: %s isFinal=%s text='%s'", 
                       msg_type, payload.get("isFinal"), (payload.get("text") or "")[:100])
        elif msg_type == "ack":
            logger.debug("WS SEND: %s seq=%s ackType=%s", msg_type, payload.get("seq"), payload.get("ackType"))
        else:
            logger.info("WS SEND: %s data=%s", msg_type, str(payload)[:200])
            
        await ws.send_text(json.dumps(payload))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to send WS message: %s", exc)


async def send_ack(websocket: WebSocket, seq: Any, ack_type: str) -> None:
    """Send acknowledgment message."""
    await send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": ack_type})
