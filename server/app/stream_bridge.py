import asyncio
import json
import logging
from typing import Any, Dict, Optional

from fastapi import WebSocket
from .adk_session import ADKSessionFactory, RunConfig


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
        # Logger
        self._log = logging.getLogger("adk.ws")
        # ADK session bridge
        self._adk_session = None
        self._bridge = None

    async def run(self) -> None:
        try:
            self._log.info("bridge_run_started")
        except Exception:
            pass
        while True:
            try:
                message = await self.ws.receive()
            except Exception as exc:
                try:
                    self._log.warning("receive_failed: %s", str(exc))
                except Exception:
                    pass
                break

            if "type" in message and message["type"] == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"] is not None:
                # Binary video chunk
                data: bytes = message["bytes"]  # type: ignore[assignment]
                self._chunk_count += 1
                self._chunk_bytes += len(data)
                try:
                    # Drop tiny/empty initial slices that Gemini Live rejects
                    if len(data) < 1024:
                        self._log.debug("video_chunk DROP small size=%s (seq=%s)", len(data), (self._expecting_video_header or {}).get("seq"))
                        self._expecting_video_header = None
                        continue
                    header = self._expecting_video_header or {}
                    self._log.debug(
                        "video_chunk recv seq=%s size=%s mime=%s",
                        header.get("seq"),
                        len(data),
                        header.get("mime"),
                    )
                    # Forward to ADK bridge if available
                    if self._bridge is not None:
                        mime = str(header.get("mime") or "video/webm;codecs=vp8,opus")
                        await self._bridge.ingest_blob(mime=mime, data=data)
                except Exception:
                    pass
                self._expecting_video_header = None
                continue

            if "text" in message and message["text"] is not None:
                try:
                    payload = json.loads(message["text"])  # type: ignore[arg-type]
                except json.JSONDecodeError:
                    await self._send_error("bad_request", "Invalid JSON message")
                    continue

                try:
                    # Minimal early log to confirm message arrival
                    kind = str(payload.get("type"))
                    self._log.info("recv_json type=%s", kind)
                except Exception:
                    pass

                await self._handle_json(payload)
                if self._closing:
                    break

    async def _handle_json(self, payload: Dict[str, Any]) -> None:
        msg_type = payload.get("type")

        if msg_type == "session_start":
            # Create ADK session/bridge
            self.session_open = True
            model = str(payload.get("model") or "gemini-live-2.5-flash-preview")
            self._log.info("session_start model=%s", model)
            self._adk_session = ADKSessionFactory.create_session(model=model, config=RunConfig())
            self._bridge = self._adk_session.bridge
            try:
                bridge_name = self._bridge.__class__.__name__ if self._bridge else "None"
                self._log.info("bridge_selected=%s", bridge_name)
            except Exception:
                pass
            try:
                await self._bridge.start()
                # Send a system instruction to the live queue if supported
                try:
                    from google.genai import types as genai_types  # type: ignore
                    system_text = (
                        "You are a helpful shopping assistant. "
                        "Describe what you can infer from incoming screen frames and "
                        "answer the user's question clearly in text."
                    )
                    content = genai_types.Content(role="system", parts=[genai_types.Part(text=system_text)])
                    if getattr(self._bridge, "_live_q", None) is not None:
                        await getattr(self._bridge, "_maybe_await")(self._bridge._live_q.send_realtime(content))  # type: ignore[attr-defined]
                except Exception:
                    pass
            except Exception as exc:
                await self._send_error("adk_start_failed", str(exc))
            await self._send_ok()
            return

        if msg_type == "activity_start":
            self.utterance_active = True
            self._chunk_count = 0
            self._chunk_bytes = 0
            self._turn_seq += 1
            self._turn_start_at_ms = self._now_ms()
            self._first_token_at_ms = None
            self._log.info("activity_start turn=%s", self._turn_seq)
            try:
                if self._bridge is not None:
                    await self._bridge.start_turn()
            except Exception:
                pass
            await self._send_ok()
            return

        if msg_type == "text_input":
            text = str(payload.get("text", ""))
            self._last_text = text
            self._log.debug("text_input len=%s preview=%s", len(text), json.dumps(text[:80]))
            # Forward user text to ADK bridge; streaming will occur on activity_end
            try:
                if self._bridge is not None and text:
                    await self._bridge.ingest_user_text(text)
            except Exception:
                pass
            return

        if msg_type == "activity_end":
            self.utterance_active = False
            # Signal ADK turn end and stream deltas back to client
            try:
                if self._bridge is not None:
                    await self._bridge.end_turn()
                    async for piece in self._bridge.stream_deltas():
                        if piece:
                            if self._first_token_at_ms is None and self._turn_start_at_ms is not None:
                                self._first_token_at_ms = self._now_ms()
                            self._log.debug("delta len=%s preview=%s", len(piece), json.dumps(piece[:120]))
                            await self._send({"type": "text_delta", "text": piece, "isPartial": True})
            except Exception:
                pass
            await self._send({"type": "turn_complete"})
            await self._send_ok()
            # Reset per-turn metrics
            total_ms = 0
            first_ms = None
            now_ms = self._now_ms()
            if self._turn_start_at_ms is not None:
                total_ms = max(0, now_ms - self._turn_start_at_ms)
            if self._first_token_at_ms is not None and self._turn_start_at_ms is not None:
                first_ms = max(0, self._first_token_at_ms - self._turn_start_at_ms)
            self._log.info(
                "TurnSummary turn=%s chunks=%s bytes=%s firstTokenMs=%s totalMs=%s",
                self._turn_seq,
                self._chunk_count,
                self._chunk_bytes,
                (first_ms if first_ms is not None else "n/a"),
                total_ms,
            )
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
            try:
                if self._bridge is not None:
                    await self._bridge.close()
            except Exception:
                pass
            self._closing = True
            return

        if msg_type == "video_chunk_header":
            # Optional header preceding a binary frame
            self._expecting_video_header = payload
            self._log.debug(
                "video_chunk_header seq=%s durMs=%s mime=%s",
                payload.get("seq"),
                payload.get("durMs"),
                payload.get("mime"),
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


