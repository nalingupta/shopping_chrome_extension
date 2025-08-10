from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional
import asyncio
import os


@dataclass
class RunConfig:
    streaming_mode: str = "BIDI"
    response_modalities: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.response_modalities is None:
            self.response_modalities = ["TEXT"]


class BaseLiveBridge:
    async def start(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def start_turn(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def ingest_blob(self, mime: str, data: bytes) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def ingest_user_text(self, text: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def end_turn(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def stream_deltas(self) -> AsyncGenerator[str, None]:  # pragma: no cover - interface
        raise NotImplementedError

    async def close(self) -> None:  # pragma: no cover - interface
        pass


class FallbackEchoBridge(BaseLiveBridge):
    """
    Fallback bridge used when ADK/Live is not available. It collects the last
    user text for a turn and streams it back as a single delta. This keeps the
    WS protocol working while allowing us to swap in the real ADK bridge later.
    """

    def __init__(self) -> None:
        self._buffer: list[bytes] = []
        self._text: str = ""

    async def start(self) -> None:
        self._buffer.clear()
        self._text = ""

    async def start_turn(self) -> None:
        self._buffer.clear()
        self._text = ""

    async def ingest_blob(self, mime: str, data: bytes) -> None:
        # Accept and drop; used only for diagnostics in echo mode
        self._buffer.append(data)

    async def ingest_user_text(self, text: str) -> None:
        self._text = text or ""

    async def end_turn(self) -> None:
        # Nothing to finalize in echo mode
        return

    async def stream_deltas(self) -> AsyncGenerator[str, None]:
        # Stream back the text once (simulate first token quickly)
        if not self._text:
            return
        # Break into a couple of chunks to simulate streaming
        text = self._text
        mid = max(1, len(text) // 2)
        yield text[:mid]
        await asyncio.sleep(0.05)
        yield text[mid:]


class ADKLiveBridge(BaseLiveBridge):
    """
    Attempt to create a real ADK Live bridge. If ADK or credentials are missing,
    the factory will fall back to FallbackEchoBridge.
    """

    def __init__(self, model: str, config: RunConfig) -> None:
        self.model = model
        self.config = config
        self._api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self._adk_ok = False
        self._queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        self._closed = False

        try:
            # Lazy import so environments without ADK still run
            from google_adk import types as adk_types  # noqa: F401
            # Placeholders for actual Agent/Runner wiring
            self._adk_ok = bool(self._api_key)
        except Exception:
            self._adk_ok = False

    async def start(self) -> None:
        # In a real implementation, construct Agent/Runner and a LiveRequestQueue here
        return

    async def start_turn(self) -> None:
        # Marker for turn start; could enqueue a control event
        return

    async def ingest_blob(self, mime: str, data: bytes) -> None:
        # In a real ADK integration, forward as types.Blob to the LiveRequestQueue
        await self._queue.put(("blob", {"mime": mime, "bytes": data}))

    async def ingest_user_text(self, text: str) -> None:
        await self._queue.put(("text", text))

    async def end_turn(self) -> None:
        await self._queue.put(("turn_end", None))

    async def stream_deltas(self) -> AsyncGenerator[str, None]:
        """
        Placeholder streaming: if ADK is available this would forward ADK deltas.
        For now, emit simple echoes of the last text event encountered before turn_end.
        """
        last_text: str = ""
        # Drain until turn_end
        while True:
            kind, payload = await self._queue.get()
            if kind == "text":
                last_text = str(payload or "")
            elif kind == "turn_end":
                break
        if last_text:
            # Stream in two chunks to simulate
            mid = max(1, len(last_text) // 2)
            yield last_text[:mid]
            await asyncio.sleep(0.05)
            yield last_text[mid:]

    async def close(self) -> None:
        self._closed = True


@dataclass
class ADKSession:
    model: str
    config: RunConfig
    bridge: BaseLiveBridge


class ADKSessionFactory:
    @staticmethod
    def create_session(model: str, config: Optional[RunConfig] = None) -> ADKSession:
        cfg = config or RunConfig()
        bridge: BaseLiveBridge
        try:
            bridge = ADKLiveBridge(model=model, config=cfg)
        except Exception:
            bridge = FallbackEchoBridge()
        return ADKSession(model=model, config=cfg, bridge=bridge)


