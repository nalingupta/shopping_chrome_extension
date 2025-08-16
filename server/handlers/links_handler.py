"""Handler for links message type."""

import logging
from typing import Any, Dict
from fastapi import WebSocket

from .base import send_json_safe, send_ack

logger = logging.getLogger("server")


async def handle_links(websocket: WebSocket, message: Dict[str, Any], state: Any) -> None:
    """Handle links message type for product links detected by the shopping extension."""
    seq = message.get("seq")
    
    try:
        links = message.get("links", [])
        ts = float(message.get("tsMs") or 0)
        logger.info("LINKS received tsMs=%.1f count=%d", ts, len(links))
        
        # Store links for potential use in segment analysis
        if hasattr(state, 'detected_links'):
            state.detected_links.extend([(ts, link) for link in links])
            # Keep only recent links (last 100)
            if len(state.detected_links) > 100:
                state.detected_links = state.detected_links[-100:]
        else:
            state.detected_links = [(ts, link) for link in links]
        
        # Log the detected product links for debugging
        for link in links:
            logger.debug("Product link detected: %s", link[:100])
        
    except Exception as exc:
        logger.warning("Failed to process links: %s", exc)
    
    await send_ack(websocket, seq, "links")
