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
        self._chunk_count: int = 0
        self._chunk_bytes: int = 0
        self._closing: bool = False
        # Turn metrics
        self._turn_seq: int = 0
        self._turn_start_at_ms: Optional[int] = None
        self._first_token_at_ms: Optional[int] = None

    async def run(self) -> None:
        while True:
            message = await self.ws.receive()

            if "type" in message and message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"] is not None:
                # Binary video chunk; Phase 1: accept and drop
                data: bytes = message["bytes"]  # type: ignore[assignment]
                self._chunk_count += 1
                self._chunk_bytes += len(data)
                try:
                    header = self._expecting_video_header or {}
                    print(
                        f"[WS] video_chunk recv seq={header.get('seq')} size={len(data)} bytes mime={header.get('mime')}"
                    )
                except Exception:
                    pass
                # Future: forward to ADK via LiveRequestQueue as Blob
                self._expecting_video_header = None
                continue

            if "text" in message and message["text"] is not None:
                try:
                    payload = json.loads(message["text"])  # type: ignore[arg-type]
                except json.JSONDecodeError:
                    await self._send_error("bad_request", "Invalid JSON message")
                    continue

                await self._handle_json(payload)
                if self._closing:
                    break

    async def _handle_json(self, payload: Dict[str, Any]) -> None:
        msg_type = payload.get("type")

        if msg_type == "session_start":
            # Phase 1: mark session; future: create ADK session
            self.session_open = True
            print(f"[WS] session_start model={payload.get('model')}")
            await self._send_ok()
            return

        if msg_type == "activity_start":
            self.utterance_active = True
            self._chunk_count = 0
            self._chunk_bytes = 0
            self._turn_seq += 1
            self._turn_start_at_ms = self._now_ms()
            self._first_token_at_ms = None
            print("[WS] activity_start")
            await self._send_ok()
            return

        if msg_type == "text_input":
            text = str(payload.get("text", ""))
            self._last_text = text
            print(f"[WS] text_input len={len(text)}")
            # Phase 1: immediately echo as a single delta and complete turn
            # Future: stream ADK deltas
            if text:
                if self._first_token_at_ms is None and self._turn_start_at_ms is not None:
                    self._first_token_at_ms = self._now_ms()
                await self._send({"type": "text_delta", "text": text, "isPartial": False})
            await self._send({"type": "turn_complete"})
            return

        if msg_type == "activity_end":
            self.utterance_active = False
            total_ms = 0
            first_ms = None
            now_ms = self._now_ms()
            if self._turn_start_at_ms is not None:
                total_ms = max(0, now_ms - self._turn_start_at_ms)
            if self._first_token_at_ms is not None and self._turn_start_at_ms is not None:
                first_ms = max(0, self._first_token_at_ms - self._turn_start_at_ms)
            print(
                f"[TURN] id={self._turn_seq} chunks={self._chunk_count} bytes={self._chunk_bytes} "
                f"first_token_ms={first_ms if first_ms is not None else 'n/a'} total_ms={total_ms}"
            )
            await self._send({"type": "turn_complete"})
            await self._send_ok()
            # Reset per-turn metrics
            self._turn_start_at_ms = None
            self._first_token_at_ms = None
            return

        if msg_type == "session_end":
            print("[WS] session_end")
            await self._send_ok()
            # Graceful close without raising to avoid noisy server error logs
            try:
                await self.ws.close()
            except Exception:
                pass
            self._closing = True
            return

        if msg_type == "video_chunk_header":
            # Optional header preceding a binary frame
            self._expecting_video_header = payload
            print(
                f"[WS] video_chunk_header seq={payload.get('seq')} durMs={payload.get('durMs')} mime={payload.get('mime')}"
            )
            return

        if msg_type == "ping":
            await self._send({"type": "pong"})
            # Update last seen for heartbeat monitoring
            # (No idle close yet; reserved for future diagnostics)
            return

        await self._send_error("unsupported_type", f"Unsupported message type: {msg_type}")

    async def _send(self, obj: Dict[str, Any]) -> None:
        await self.ws.send_json(obj)

    async def _send_ok(self) -> None:
        await self._send({"ok": True})

    async def _send_error(self, code: str, message: str) -> None:
        await self._send({"type": "error", "code": code, "message": message})

    @staticmethod
    def _now_ms() -> int:
        return int(asyncio.get_event_loop().time() * 1000)


