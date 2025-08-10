from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional
import inspect
from collections.abc import AsyncIterator, AsyncIterable
import asyncio
import os
import logging
import uuid


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
        self._capabilities_logged: bool = False
        # Live attach + text fallback helpers
        self._live_attached: bool = False
        self._last_user_text: str = ""
        self._user_id: str = "extension"
        self._session_id: str = uuid.uuid4().hex
        self._session_obj: Any = None

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

            # Construct Agent (latest ADK requires a name). Normalize model id (strip optional "models/")
            effective_model = (self.model or "").replace("models/", "", 1)
            _log.info("adk_agent_model=%s", effective_model)
            try:
                self._agent = ADK_Agent(name="adk_bridge", model=effective_model, api_key=self._api_key)  # type: ignore
            except Exception:
                self._agent = ADK_Agent(name="adk_bridge", model=effective_model)  # type: ignore

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
            # Best-effort: create a session up front if the runner exposes a session service
            try:
                svc = getattr(self, "_session_service", None)
                create_fn = getattr(svc, "create_session", None) if svc else None
                if callable(create_fn):
                    # Capture the returned Session object if provided by this ADK version
                    self._session_obj = await create_fn(
                        app_name="adk_bridge",
                        user_id=self._user_id,
                        session_id=self._session_id,
                    )
            except Exception:
                self._session_obj = None
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
                # Save last user text for optional non-live fallback
                self._last_user_text = text
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
                    # If we never attached to live, try a non-live one-shot to avoid UI hang
                    if not self._live_attached:
                        try:
                            fb_text = await self._run_text_fallback()
                            if fb_text:
                                yield fb_text
                                break
                        except Exception:
                            pass
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

            bridge_log = logging.getLogger("adk.bridge")

            # One-time capability dump for diagnostics
            if not self._capabilities_logged:
                candidate_names = [
                    "run_live",
                    "run_async",
                    "run",
                    "live",
                    "stream",
                    "events",
                    "__aiter__",
                ]
                available = [
                    name for name in candidate_names if hasattr(self._runner, name)
                ]
                try:
                    ver = None
                    try:
                        ver = __import__("google.adk").__version__  # type: ignore[attr-defined]
                    except Exception:
                        ver = "unknown"
                    bridge_log.info(
                        "runner_capabilities adk_version=%s available=%s",
                        ver,
                        ",".join(available) if available else "none",
                    )
                    # Log method signatures for run_live/run_async if available
                    for nm in ("run_live", "run_async"):
                        fn = getattr(self._runner, nm, None)
                        if callable(fn):
                            try:
                                sig = str(inspect.signature(fn))
                                bridge_log.info("runner_signature %s%s", nm, sig)
                            except Exception:
                                pass
                except Exception:
                    pass
                self._capabilities_logged = True

            # Try to obtain an async-iterable of events from the runner using common entrypoints
            # Prepare ADK-native RunConfig with BIDI streaming and TEXT output
            adk_run_config = None
            try:
                from google.adk.runners import RunConfig as ADK_RunConfig  # type: ignore
                from google.adk.runners import StreamingMode as ADK_StreamingMode  # type: ignore
                adk_run_config = ADK_RunConfig(
                    streaming_mode=ADK_StreamingMode.BIDI,
                    response_modalities=["TEXT"],
                )
            except Exception:
                adk_run_config = None

            # First: explicit attach to run_live using exact signature from logs
            events_iter: Optional[AsyncIterator[Any]] = None
            try:
                run_live_fn = getattr(self._runner, "run_live", None)
                if callable(run_live_fn):
                    explicit_kwargs = {"live_request_queue": self._live_q}
                    if adk_run_config is not None:
                        explicit_kwargs["run_config"] = adk_run_config
                    if self._session_obj is not None:
                        explicit_kwargs["session"] = self._session_obj
                    else:
                        explicit_kwargs["user_id"] = self._user_id
                        explicit_kwargs["session_id"] = self._session_id
                    result = run_live_fn(**explicit_kwargs)  # type: ignore[misc]
                    if inspect.isawaitable(result):
                        result = await result  # type: ignore[assignment]
                    # Accept async iterables only
                    if isinstance(result, (AsyncIterator, AsyncIterable)) or hasattr(result, "__aiter__"):
                        try:
                            bridge_log.info(
                                "live_attach method=run_live args=0 kwargs=%s",
                                list(explicit_kwargs.keys()),
                            )
                        except Exception:
                            pass
                        events_iter = result  # type: ignore[assignment]
            except Exception as exc:
                try:
                    bridge_log.warning("live_explicit_attach_failed err=%s", str(exc))
                except Exception:
                    pass

            async def _resolve_events_iter() -> Optional[AsyncIterator[Any]]:
                method_candidates = [
                    "run_live",
                    "run_async",
                    "live",
                    "stream",
                    "events",
                ]

                def _is_async_iter(obj: Any) -> bool:
                    try:
                        return isinstance(obj, (AsyncIterator, AsyncIterable)) or hasattr(obj, "__aiter__")
                    except Exception:
                        return hasattr(obj, "__aiter__")

                # Try bound methods first
                for name in method_candidates:
                    func = getattr(self._runner, name, None)
                    if not callable(func):
                        continue
                    # Try a sequence of signatures
                    call_attempts = []
                    # Positional
                    call_attempts.append({"args": (self._agent, self._live_q), "kwargs": {}})
                    call_attempts.append({"args": (self._live_q,), "kwargs": {}})
                    # Keyword permutations
                    queue_kw_names = ["queue", "live_queue", "request_queue", "live_request_queue", "input_queue"]
                    agent_kw_names = ["agent", "llm_agent", "runner_agent"]
                    # Strongly-preferred exact signature from runner_signature: live_request_queue + run_config + ids
                    if adk_run_config is not None:
                        # Use Session object if available from session_service, it can replace ids
                        if self._session_obj is not None:
                            call_attempts.insert(0, {
                                "args": (),
                                "kwargs": {
                                    "live_request_queue": self._live_q,
                                    "run_config": adk_run_config,
                                    "session": self._session_obj,
                                },
                            })
                        call_attempts.insert(0, {
                            "args": (),
                            "kwargs": {
                                "live_request_queue": self._live_q,
                                "run_config": adk_run_config,
                                "user_id": self._user_id,
                                "session_id": self._session_id,
                            },
                        })
                        # Also allow without run_config (defaults) but with ids
                        call_attempts.insert(1, {
                            "args": (),
                            "kwargs": {
                                "live_request_queue": self._live_q,
                                "user_id": self._user_id,
                                "session_id": self._session_id,
                            },
                        })
                    for qn in queue_kw_names:
                        call_attempts.append({"args": (), "kwargs": {qn: self._live_q}})
                        for an in agent_kw_names:
                            call_attempts.append({"args": (), "kwargs": {an: self._agent, qn: self._live_q}})
                    # Bare call
                    call_attempts.append({"args": (), "kwargs": {}})
                    for attempt in call_attempts:
                        try:
                            result = func(*attempt["args"], **attempt["kwargs"])  # type: ignore[misc]
                        except TypeError:
                            continue
                        except Exception as exc:
                            try:
                                bridge_log.warning(
                                    "live_call_failed method=%s args=%s kwargs=%s err=%s",
                                    name,
                                    len(attempt["args"]),
                                    list(attempt["kwargs"].keys()),
                                    str(exc),
                                )
                            except Exception:
                                pass
                            # Non-signature errors: try next attempt as well
                            continue
                        # Await coroutines to get the iterator
                        if inspect.isawaitable(result):
                            try:
                                result = await result  # type: ignore[assignment]
                            except Exception as exc:
                                try:
                                    bridge_log.warning(
                                        "live_call_await_failed method=%s err=%s",
                                        name,
                                        str(exc),
                                    )
                                except Exception:
                                    pass
                                continue
                        # Accept async iterables
                        if _is_async_iter(result):
                            # For run_live specifically, ensure we included identity (session or ids)
                            if name == "run_live":
                                kw = attempt.get("kwargs", {})
                                has_ids = ("user_id" in kw and "session_id" in kw)
                                has_session = ("session" in kw)
                                if not (has_ids or has_session):
                                    # Skip iterators that will error due to missing identity
                                    try:
                                        bridge_log.info(
                                            "skip_attach_incomplete method=run_live reason=missing_ids_or_session"
                                        )
                                    except Exception:
                                        pass
                                    continue
                            try:
                                bridge_log.info(
                                    "live_attach method=%s args=%s kwargs=%s",
                                    name,
                                    len(attempt["args"]),
                                    list(attempt["kwargs"].keys()),
                                )
                            except Exception:
                                pass
                            return result  # type: ignore[return-value]
                        # If result object exposes an async-iterable sub-attribute, use it
                        for attr in ("events", "stream", "responses", "outputs"):
                            try:
                                candidate = getattr(result, attr, None)
                            except Exception:
                                candidate = None
                            if candidate is not None and _is_async_iter(candidate):
                                try:
                                    bridge_log.info("live_attach method=%s via_attr=%s", name, attr)
                                except Exception:
                                    pass
                                return candidate  # type: ignore[return-value]

                # As a last resort, if the runner itself is async-iterable, iterate it
                if hasattr(self._runner, "__aiter__"):
                    try:
                        bridge_log.info("live_attach method=__aiter__ on runner instance")
                    except Exception:
                        pass
                    return self._runner  # type: ignore[return-value]

                return None

            if events_iter is None:
                events_iter = await _resolve_events_iter()
            if events_iter is None:
                bridge_log.warning(
                    "run_live_unavailable: no compatible live entrypoint found on Runner"
                )
                self._live_attached = False
                return
            else:
                self._live_attached = True

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

    async def _run_text_fallback(self) -> Optional[str]:
        """Best-effort non-live single-turn generation using runner.run_async/run."""
        try:
            if not self._last_user_text or self._runner is None:
                return None
            # Try async run first
            run_async = getattr(self._runner, "run_async", None)
            if callable(run_async):
                try:
                    # Build types.Content(new_message) per signature in logs
                    from google.genai import types as genai_types  # type: ignore
                    new_message = genai_types.Content(parts=[genai_types.Part(text=self._last_user_text)])
                    # Prefer providing run_config to enforce TEXT output and BIDI (even though it's non-live)
                    run_cfg = None
                    try:
                        from google.adk.runners import RunConfig as ADK_RunConfig  # type: ignore
                        from google.adk.runners import StreamingMode as ADK_StreamingMode  # type: ignore
                        run_cfg = ADK_RunConfig(
                            streaming_mode=ADK_StreamingMode.NONE,
                            response_modalities=["TEXT"],
                        )
                    except Exception:
                        run_cfg = None

                    kwargs = {"user_id": self._user_id, "session_id": self._session_id, "new_message": new_message}
                    if run_cfg is not None:
                        kwargs["run_config"] = run_cfg
                    res = run_async(**kwargs)
                    if inspect.isawaitable(res):
                        res = await res  # type: ignore[assignment]
                    pieces = self._extract_text(res)
                    text = "".join(pieces).strip()
                    if text:
                        return text
                except Exception:
                    pass
            # Fallback to sync run
            run_sync = getattr(self._runner, "run", None)
            if callable(run_sync):
                try:
                    from google.genai import types as genai_types  # type: ignore
                    new_message = genai_types.Content(parts=[genai_types.Part(text=self._last_user_text)])
                    res = run_sync(user_id=self._user_id, session_id=self._session_id, new_message=new_message)
                    pieces = self._extract_text(res)
                    text = "".join(pieces).strip()
                    if text:
                        return text
                except Exception:
                    pass
        except Exception:
            return None
        return None

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


