from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional
import asyncio
import os
import logging


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
        self._closed = False

        # Live ingestion/output structures
        self._live_q = None  # ADK LiveRequestQueue (set when ADK is available)
        self._runner = None  # ADK Runner
        self._agent = None   # ADK Agent
        self._consumer_task: Optional[asyncio.Task] = None
        self._out_q: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        self._awaiting_turn_end: bool = False

        _log = logging.getLogger("adk.bridge")
        try:
            _path = None
            # Latest layout observed in env: queue under google.adk.agents.live_request_queue, runner in google.adk.runners
            try:
                from google.adk.agents.live_request_queue import LiveRequestQueue as ADK_LiveRequestQueue  # type: ignore
                from google.adk.agents import Agent as ADK_Agent  # type: ignore
                try:
                    from google.adk.runners import Runner as ADK_LiveRunner  # type: ignore
                except Exception:
                    ADK_LiveRunner = None  # type: ignore
                _path = "google.adk"
            except Exception:
                # Older layout fallback (if present)
                from google_adk import live as adk_live  # type: ignore
                from google_adk import agent as adk_agent  # type: ignore
                from google_adk import runner as adk_runner  # type: ignore
                ADK_LiveRequestQueue = getattr(adk_live, "LiveRequestQueue", None)  # type: ignore
                ADK_LiveRunner = getattr(adk_runner, "Runner", None)  # type: ignore
                ADK_Agent = adk_agent.Agent  # type: ignore
                _path = "google_adk"

            if not ADK_LiveRequestQueue or not ADK_LiveRunner or not ADK_Agent:
                raise RuntimeError("Missing ADK classes (LiveRequestQueue/LiveRunner/Agent) in %s" % _path)

            if not self._api_key:
                self._adk_ok = False
                _log.warning("adk_init_skipped: missing API key in env (GEMINI_API_KEY/GOOGLE_API_KEY)")
                return

            # Construct Agent (latest ADK requires a name)
            try:
                self._agent = ADK_Agent(name="adk_bridge", model=self.model, api_key=self._api_key)  # type: ignore
            except Exception:
                self._agent = ADK_Agent(name="adk_bridge", model=self.model)  # type: ignore

            # Construct LiveRequestQueue and Runner
            self._live_q = ADK_LiveRequestQueue()  # type: ignore

            # Prefer InMemoryRunner if available (provides a session_service internally)
            runner_ok = False
            try:
                from google.adk.runners import InMemoryRunner as ADK_InMemoryRunner  # type: ignore
                self._runner = ADK_InMemoryRunner(agent=self._agent, app_name="adk_bridge")  # type: ignore[call-arg]
                self._session_service = getattr(self._runner, "session_service", None)
                runner_ok = True
                _log.info("adk_init_ok path=%s model=%s runner=InMemoryRunner", _path, self.model)
            except Exception:
                # Fallback: construct base Runner with an in-memory/local session service
                try:
                    from google.adk.runners import Runner as ADK_BaseRunner  # type: ignore
                    session_service = None
                    try:
                        from google.adk.sessions import InMemorySessionService as ADK_InMemSessionService  # type: ignore
                        session_service = ADK_InMemSessionService()
                    except Exception:
                        try:
                            from google.adk.sessions import LocalSessionService as ADK_LocalSessionService  # type: ignore
                            session_service = ADK_LocalSessionService()
                        except Exception:
                            try:
                                from google.adk.sessions import SessionService as ADK_SessionService  # type: ignore
                                session_service = ADK_SessionService()  # may fail if abstract
                            except Exception:
                                session_service = None
                    if session_service is None:
                        raise RuntimeError("no_session_service_available")
                    self._runner = ADK_BaseRunner(
                        agent=self._agent,
                        app_name="adk_bridge",
                        session_service=session_service,
                    )  # type: ignore[call-arg]
                    self._session_service = session_service
                    runner_ok = True
                    _log.info("adk_init_ok path=%s model=%s runner=Runner(session_service=%s)", _path, self.model, type(session_service).__name__)
                except Exception as exc:
                    runner_ok = False
                    _log.warning("adk_init_failed: %s", str(exc), exc_info=True)

            if not runner_ok:
                self._adk_ok = False
                return

            self._adk_ok = True
        except Exception as exc:
            self._adk_ok = False
            _log.warning("adk_init_failed: %s", str(exc), exc_info=True)

    async def start(self) -> None:
        if not self._adk_ok or self._closed:
            return
        # Start background consumer to drain ADK live events and push text deltas
        if self._consumer_task is None or self._consumer_task.done():
            self._consumer_task = asyncio.create_task(self._consume_live_events())
        logging.getLogger("adk.bridge").info(
            "adk_start model=%s streaming_mode=%s modalities=%s",
            self.model,
            self.config.streaming_mode,
            ",".join(self.config.response_modalities or []),
        )

    async def start_turn(self) -> None:
        # Mark a new turn boundary
        self._awaiting_turn_end = False
        logging.getLogger("adk.bridge").debug("start_turn")

    async def ingest_blob(self, mime: str, data: bytes) -> None:
        if not self._adk_ok or self._closed:
            return
        try:
            from google.genai import types as genai_types  # type: ignore
            if self._live_q is not None:
                blob = genai_types.Blob(data=data, mime_type=str(mime))
                await self._maybe_await(self._live_q.send_realtime(blob))
                logging.getLogger("adk.bridge").debug(
                    "ingest_blob bytes=%s mime=%s", len(data), mime
                )
        except Exception:
            # Swallow to keep session resilient
            pass

    async def ingest_user_text(self, text: str) -> None:
        if not self._adk_ok or self._closed:
            return
        try:
            from google.genai import types as genai_types  # type: ignore
            if self._live_q is not None and text:
                # Send as a simple text part; runner will assemble into a turn
                part = genai_types.Part(text=str(text))
                await self._maybe_await(self._live_q.send_realtime(part))
                preview = (text or "")[:80].replace("\n", " ")
                logging.getLogger("adk.bridge").debug(
                    "ingest_user_text len=%s preview=%s", len(text), preview
                )
        except Exception:
            pass

    async def end_turn(self) -> None:
        # Signal to ADK that this turn's inputs are done (best-effort; API varies)
        self._awaiting_turn_end = True
        try:
            if self._live_q is not None:
                # Prefer the latest close method name first
                for name in ("close_request", "end_input", "finish_input", "close_input"):
                    if hasattr(self._live_q, name):
                        try:
                            await self._maybe_await(getattr(self._live_q, name)())
                            logging.getLogger("adk.bridge").debug("end_turn signaled via %s", name)
                            break
                        except Exception:
                            continue
        except Exception:
            pass

    async def stream_deltas(self) -> AsyncGenerator[str, None]:
        if not self._adk_ok or self._closed:
            # No ADK available → no deltas
            return
        # Drain output queue until we see a turn boundary or silence while awaiting turn end
        idle_ticks = 0
        while True:
            try:
                kind, payload = await asyncio.wait_for(self._out_q.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if self._awaiting_turn_end:
                    # Treat quiet period after end_turn as completion
                    break
                continue

            if kind == "text" and payload:
                yield str(payload)
                idle_ticks = 0
            elif kind == "turn_end":
                break
            elif kind == "error":
                # Stop the turn on error
                break

    async def close(self) -> None:
        self._closed = True
        try:
            if self._consumer_task is not None:
                self._consumer_task.cancel()
        except Exception:
            pass

    async def _consume_live_events(self) -> None:
        """Continuously consume ADK live events and push text deltas to _out_q."""
        try:
            if self._runner is None or self._live_q is None:
                return

            # Obtain a live-events async iterator using best-effort compatibility across ADK versions
            events_iter = None
            bridge_log = logging.getLogger("adk.bridge")
            try:
                # Prefer bound method if present
                run_live = getattr(self._runner, "run_live", None)
                if callable(run_live):
                    # Try (agent, queue) first, then (queue)
                    try:
                        events_iter = run_live(self._agent, self._live_q)  # type: ignore[misc]
                    except TypeError:
                        events_iter = run_live(self._live_q)  # type: ignore[misc]
                else:
                    # Fallback: classmethod or module-level
                    run_live_cls = getattr(self._runner.__class__, "run_live", None)
                    if callable(run_live_cls):
                        try:
                            events_iter = run_live_cls(self._agent, self._live_q)  # type: ignore[misc]
                        except TypeError:
                            events_iter = run_live_cls(self._live_q)  # type: ignore[misc]
            except Exception:
                # Will be handled below as no iterator
                pass

            if events_iter is None:
                bridge_log.warning("run_live_unavailable: no compatible run_live signature found on Runner")
                return

            async for event in events_iter:
                # Extract any text pieces and enqueue them
                for piece in self._extract_text(event):
                    if piece:
                        await self._out_q.put(("text", piece))
                        bridge_log.debug(
                            "delta len=%s preview=%s", len(piece), (piece or "")[:120].replace("\n", " ")
                        )
                # Heuristics for turn completion markers
                if self._is_turn_complete_event(event):
                    await self._out_q.put(("turn_end", None))
                    bridge_log.info("turn_complete from ADK")
        except asyncio.CancelledError:
            pass
        except Exception:
            # On any error, unblock any waiting streams for the current turn
            try:
                await self._out_q.put(("error", "live_consumer_failed"))
                await self._out_q.put(("turn_end", None))
                logging.getLogger("adk.bridge").warning("live_consumer_failed", exc_info=True)
            except Exception:
                pass

    def _extract_text(self, event: Any) -> list[str]:
        """Best-effort extraction of text deltas from ADK live events."""
        chunks: list[str] = []
        try:
            # Dict-like events
            if isinstance(event, dict):
                # Common shapes: {"text": "..."} or nested parts
                if isinstance(event.get("text"), str):
                    chunks.append(str(event["text"]))
                sc = event.get("serverContent") or event.get("server_content")
                if sc:
                    parts = sc.get("modelTurn", {}).get("parts") or sc.get("parts")
                    if isinstance(parts, list):
                        for p in parts:
                            t = (p or {}).get("text")
                            if isinstance(t, str):
                                chunks.append(t)
            else:
                # Object-like events: try attributes
                t = getattr(event, "text", None)
                if isinstance(t, str):
                    chunks.append(t)
                output = getattr(event, "output", None)
                if output is not None:
                    parts = getattr(output, "parts", None) or getattr(output, "contents", None)
                    if isinstance(parts, list):
                        for p in parts:
                            pt = getattr(p, "text", None) if hasattr(p, "text") else None
                            if isinstance(pt, str):
                                chunks.append(pt)
        except Exception:
            pass
        return chunks

    def _is_turn_complete_event(self, event: Any) -> bool:
        """Heuristic to detect a turn completion event from ADK."""
        try:
            if isinstance(event, dict):
                return bool(
                    event.get("turnComplete")
                    or event.get("turn_complete")
                    or (event.get("serverContent") or {}).get("turnComplete") is True
                    or (event.get("server_content") or {}).get("turn_complete") is True
                )
            # Attribute-based detection
            return bool(
                getattr(event, "turnComplete", False)
                or getattr(event, "turn_complete", False)
                or getattr(getattr(event, "serverContent", object()), "turnComplete", False)
                or getattr(getattr(event, "server_content", object()), "turn_complete", False)
            )
        except Exception:
            return False

    async def _maybe_await(self, value: Any) -> Any:
        if asyncio.iscoroutine(value) or isinstance(value, asyncio.Future):
            return await value
        return value


@dataclass
class ADKSession:
    model: str
    config: RunConfig
    bridge: BaseLiveBridge


class ADKSessionFactory:
    @staticmethod
    def create_session(model: str, config: Optional[RunConfig] = None) -> ADKSession:
        cfg = config or RunConfig()
        log = logging.getLogger("adk.bridge")
        try:
            adk_bridge = ADKLiveBridge(model=model, config=cfg)
            if getattr(adk_bridge, "_adk_ok", False):
                log.info("bridge_select using=ADK model=%s", model)
                return ADKSession(model=model, config=cfg, bridge=adk_bridge)
            else:
                log.warning("bridge_select using=Fallback reason=adk_not_ok model=%s", model)
        except Exception as exc:
            log.warning("bridge_select using=Fallback reason=exception err=%s", str(exc), exc_info=True)
        return ADKSession(model=model, config=cfg, bridge=FallbackEchoBridge())


