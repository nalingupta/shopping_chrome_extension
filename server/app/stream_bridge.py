import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import WebSocket


class LiveStreamBridge:
    """
    WebSocket <-> (future) ADK Live bridge.

    Phase 1: Skeleton that accepts the specified client messages, ignores binary
    video frames for now, and echoes text as text_delta followed by turn_complete.
    """

    def __init__(self, websocket: WebSocket) -> None:
        self.ws: WebSocket = websocket
        self.session_open: bool = False
        self.utterance_active: bool = False
        self._last_text: str = ""
        self._expecting_video_header: Optional[Dict[str, Any]] = None

    async def run(self) -> None:
        while True:
            message = await self.ws.receive()

            if "type" in message and message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"] is not None:
                # Binary video chunk; Phase 1: accept and drop
                # Future: forward to ADK via LiveRequestQueue as Blob
                continue

            if "text" in message and message["text"] is not None:
                try:
                    payload = json.loads(message["text"])  # type: ignore[arg-type]
                except json.JSONDecodeError:
                    await self._send_error("bad_request", "Invalid JSON message")
                    continue

                await self._handle_json(payload)

    async def _handle_json(self, payload: Dict[str, Any]) -> None:
        msg_type = payload.get("type")

        if msg_type == "session_start":
            # Phase 1: mark session; future: create ADK session
            self.session_open = True
            await self._send_ok()
            return

        if msg_type == "activity_start":
            self.utterance_active = True
            await self._send_ok()
            return

        if msg_type == "text_input":
            text = str(payload.get("text", ""))
            self._last_text = text
            # Phase 1: immediately echo as a single delta and complete turn
            # Future: stream ADK deltas
            if text:
                await self._send({"type": "text_delta", "text": text, "isPartial": False})
            await self._send({"type": "turn_complete"})
            return

        if msg_type == "activity_end":
            self.utterance_active = False
            await self._send({"type": "turn_complete"})
            await self._send_ok()
            return

        if msg_type == "session_end":
            await self._send_ok()
            # Allow the client to close; we break the loop by raising disconnect
            raise asyncio.CancelledError

        if msg_type == "video_chunk_header":
            # Optional header preceding a binary frame
            self._expecting_video_header = payload
            return

        if msg_type == "ping":
            await self._send({"type": "pong"})
            return

        await self._send_error("unsupported_type", f"Unsupported message type: {msg_type}")

    async def _send(self, obj: Dict[str, Any]) -> None:
        await self.ws.send_json(obj)

    async def _send_ok(self) -> None:
        await self._send({"ok": True})

    async def _send_error(self, code: str, message: str) -> None:
        await self._send({"type": "error", "code": code, "message": message})


