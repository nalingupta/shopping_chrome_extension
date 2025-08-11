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
        # One-time diagnostics for first few live events
        self._diag_events_remaining: int = 3
        # Recent event keys (for idle diagnostics)
        self._recent_event_keys: list[list[str]] = []
        # Per-turn lifecycle state and idle timeout configuration
        self._turn_opened: bool = False
        try:
            self._idle_turn_timeout_ms: int = int(os.getenv("ADK_IDLE_TURN_TIMEOUT_MS", "60000"))
        except Exception:
            self._idle_turn_timeout_ms = 60000

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

            # Prefer Vertex ADC/service account for Live models. API key is not used for Vertex Live.
            adc_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            project = os.getenv("GOOGLE_CLOUD_PROJECT")
            location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
            if not (adc_path and os.path.exists(adc_path)):
                self._adk_ok = False
                _log.error("adk_init_missing_adc: set GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT/LOCATION for Vertex Live")
                return

            # Construct Agent (latest ADK requires a name). Normalize model id (strip optional "models/")
            effective_model = (self.model or "").replace("models/", "", 1)
            _log.info("adk_agent_model=%s", effective_model)
            # Apply agent instructions if supported by this ADK build
            instruction_text = (
                "You are a helpful shopping assistant. "
                "Describe what you can infer from incoming screen frames and "
                "answer the user's question clearly in text."
            )
            agent_constructed = False
            # Vertex mode: avoid api_key; prefer passing project/location if supported
            try:
                self._agent = ADK_Agent(  # type: ignore
                    name="adk_bridge",
                    model=effective_model,
                    instructions=instruction_text,
                    project=project,
                    location=location,
                )
                agent_constructed = True
            except Exception:
                try:
                    self._agent = ADK_Agent(name="adk_bridge", model=effective_model, project=project, location=location)  # type: ignore
                    agent_constructed = True
                except Exception:
                    self._agent = ADK_Agent(name="adk_bridge", model=effective_model)  # type: ignore
                    agent_constructed = True
            if agent_constructed:
                try:
                    _log.info("adk_agent_instructions_set len=%s", len(instruction_text))
                except Exception:
                    pass

            # Construct LiveRequestQueue and Runner
            self._live_q = ADK_LiveRequestQueue()  # type: ignore

            # Prefer InMemoryRunner if available (provides a session_service internally)
            runner_ok = False
            try:
                from google.adk.runners import InMemoryRunner as ADK_InMemoryRunner  # type: ignore
                self._runner = ADK_InMemoryRunner(agent=self._agent, app_name="adk_bridge")  # type: ignore[call-arg]
                self._session_service = getattr(self._runner, "session_service", None)
                runner_ok = True
                _log.info("adk_init_ok path=%s model=%s runner=InMemoryRunner vertex_mode=true project=%s location=%s", _path, self.model, project, location)
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
                    _log.info("adk_init_ok path=%s model=%s runner=Runner(session_service=%s) vertex_mode=true project=%s location=%s", _path, self.model, type(session_service).__name__, project, location)
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
            "adk_session_started user_id=%s session_id=%s live_q=%s runner=%s",
            self._user_id,
            self._session_id,
            type(self._live_q).__name__ if self._live_q is not None else "None",
            type(self._runner).__name__ if self._runner is not None else "None",
        )
        # Log live queue capabilities (methods) once
        try:
            if self._live_q is not None:
                candidate_methods = [
                    "send_realtime", "send", "enqueue", "put", "write",
                    "start_request", "begin_input", "open_input", "open_request", "start_input",
                    "close_request", "end_input", "finish_input", "close_input",
                ]
                available = [m for m in candidate_methods if hasattr(self._live_q, m)]
                logging.getLogger("adk.bridge").info(
                    "live_queue_capabilities type=%s methods=%s",
                    type(self._live_q).__name__,
                    ",".join(available) if available else "none",
                )
        except Exception:
            pass
        logging.getLogger("adk.bridge").info(
            "adk_start model=%s streaming_mode=%s modalities=%s",
            self.model,
            self.config.streaming_mode,
            ",".join(self.config.response_modalities or []),
        )

    async def start_turn(self) -> None:
        # Mark a new turn boundary and open a request on the live queue if required
        self._awaiting_turn_end = False
        bridge_log = logging.getLogger("adk.bridge")
        bridge_log.debug("start_turn")
        # If consumer task died earlier (e.g., model error), try to restart it lazily
        try:
            if self._adk_ok and not self._closed:
                if self._consumer_task is None or self._consumer_task.done():
                    bridge_log.info("live_consumer_restart")
                    self._consumer_task = asyncio.create_task(self._consume_live_events())
        except Exception:
            pass
        try:
            if self._live_q is not None:
                # Some ADK builds require explicitly opening an input request
                open_methods = (
                    "start_request",
                    "begin_input",
                    "open_input",
                    "open_request",
                    "start_input",
                )
                started = False
                for name in open_methods:
                    if hasattr(self._live_q, name):
                        try:
                            await self._maybe_await(getattr(self._live_q, name)())
                            bridge_log.info("start_turn signaled via %s", name)
                            started = True
                            break
                        except Exception:
                            continue
                if not started:
                    bridge_log.info("start_turn open_method_not_found; proceeding without explicit open")
                self._turn_opened = started
        except Exception:
            # Non-fatal; continue without explicit open
            pass

    async def ingest_blob(self, mime: str, data: bytes) -> None:
        if not self._adk_ok or self._closed:
            return
        try:
            if self._live_q is None:
                return
            from google.genai import types as genai_types  # type: ignore
            safe_mime = str(mime or "").strip() or "application/octet-stream"
            blob = genai_types.Blob(data=data, mime_type=safe_mime)
            used_method = None
            for name in ("send_realtime", "send", "enqueue", "put", "write"):
                fn = getattr(self._live_q, name, None)
                if not callable(fn):
                    continue
                try:
                    await self._maybe_await(fn(blob))  # type: ignore[misc]
                    used_method = name
                    break
                except Exception as exc:
                    try:
                        logging.getLogger("adk.bridge").warning(
                            "ingest_blob_send_failed method=%s err=%s", name, str(exc)
                        )
                    except Exception:
                        pass
                    continue
            logging.getLogger("adk.bridge").debug(
                "ingest_blob bytes=%s mime=%s method=%s send_kind=blob",
                len(data),
                safe_mime,
                used_method or "unknown",
            )
        except Exception:
            try:
                logging.getLogger("adk.bridge").error("ingest_blob exception; dropping frame", exc_info=True)
            except Exception:
                pass

    async def ingest_user_text(self, text: str) -> None:
        if not self._adk_ok or self._closed:
            return
        try:
            # Prefer ADK types for live queue, fallback to genai types
            adk_types = None
            try:
                from google.adk import types as adk_types  # type: ignore
            except Exception:
                adk_types = None
            from google.genai import types as genai_types  # type: ignore
            if self._live_q is not None and text:
                # Build a Content object and try multiple enqueue method names for compatibility
                content = None
                if adk_types is not None:
                    try:
                        content = adk_types.Content(role="user", parts=[adk_types.Part(text=str(text))])
                    except Exception:
                        content = None
                if content is None:
                    try:
                        content = genai_types.Content(role="user", parts=[genai_types.Part(text=str(text))])
                    except Exception:
                        content = None
                log = logging.getLogger("adk.bridge")
                used_method = None
                # Preferred method names
                candidate_methods = (
                    "send_realtime",
                    "send",
                    "enqueue",
                    "put",
                    "write",
                )
                for name in candidate_methods:
                    fn = getattr(self._live_q, name, None)
                    if not callable(fn):
                        continue
                    try:
                        await self._maybe_await(fn(content if content is not None else str(text)))  # type: ignore[misc]
                        used_method = name
                        break
                    except Exception:
                        continue
                # If all failed with structured Content, try again with raw text
                if used_method is None:
                    for name in candidate_methods:
                        fn = getattr(self._live_q, name, None)
                        if not callable(fn):
                            continue
                        try:
                            await self._maybe_await(fn(str(text)))  # type: ignore[misc]
                            used_method = name
                            break
                        except Exception:
                            continue
                preview = (text or "")[:80].replace("\n", " ")
                log.info(
                    "ingest_user_text len=%s preview=%s method=%s",
                    len(text),
                    preview,
                    used_method or "unknown",
                )
                # Save last user text for optional non-live fallback
                self._last_user_text = text
        except Exception as exc:
            try:
                logging.getLogger("adk.bridge").warning("user_text_enqueue_failed err=%s", str(exc))
            except Exception:
                pass

    async def end_turn(self) -> None:
        # Signal to ADK that this turn's inputs are done (best-effort; API varies)
        self._awaiting_turn_end = True
        try:
            if self._live_q is not None:
                # Prefer the latest close method name first
                closed = False
                for name in ("close_request", "end_input", "finish_input", "close_input"):
                    if hasattr(self._live_q, name):
                        try:
                            await self._maybe_await(getattr(self._live_q, name)())
                            logging.getLogger("adk.bridge").info("end_turn signaled via %s", name)
                            closed = True
                            break
                        except Exception:
                            continue
                if not closed:
                    logging.getLogger("adk.bridge").info(
                        "end_turn close_method_not_found; proceeding without explicit close"
                    )
                # Only mark turn closed if we successfully invoked a close method
                if closed:
                    self._turn_opened = False
        except Exception:
            pass

    async def stream_deltas(self) -> AsyncGenerator[str, None]:
        if not self._adk_ok or self._closed:
            # No ADK available → log and stop (no fallback model)
            try:
                logging.getLogger("adk.bridge").error("adk_live_unavailable: no ADK bridge; live_model_required")
            except Exception:
                pass
            return
        # Drain output queue until we see a turn boundary or silence while awaiting turn end
        idle_ticks = 0
        while True:
            try:
                kind, payload = await asyncio.wait_for(self._out_q.get(), timeout=0.5)
            except asyncio.TimeoutError:
                if self._awaiting_turn_end:
                    idle_ticks += 1
                    # If live is attached but quiet, fall back after configured idle window
                    if (idle_ticks * 500) >= self._idle_turn_timeout_ms:
                        try:
                            logging.getLogger("adk.bridge").warning(
                                "idle_no_token recent_event_keys=%s", self._recent_event_keys[-3:]
                            )
                        except Exception:
                            pass
                        # As a last resort, attempt non-live text fallback so the UI receives a response
                        try:
                            fallback_text = await self._run_text_fallback()
                        except Exception:
                            fallback_text = None
                        if isinstance(fallback_text, str) and fallback_text.strip():
                            try:
                                await self._out_q.put(("text", fallback_text))
                            except Exception:
                                pass
                            # Yield once below on next loop iteration
                        # End the turn either way to prevent UI hang
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
                from google.adk.agents.run_config import (
                    RunConfig as ADK_RunConfig,
                    StreamingMode as ADK_StreamingMode,
                )  # type: ignore
                # Prefer enum modality if available
                ADK_ResponseModality = None  # type: ignore
                GENAI_Live_Modality = None  # type: ignore
                GOOGLE_GENAI_Live_Modality = None  # type: ignore
                GENAI_Types_Modality = None  # type: ignore
                try:
                    from google.adk.agents.run_config import (
                        ResponseModality as ADK_ResponseModality,
                    )  # type: ignore
                except Exception:
                    ADK_ResponseModality = None  # type: ignore
                if ADK_ResponseModality is None:
                    try:
                        # python-genai live Modality
                        from genai.live import Modality as GENAI_Live_Modality  # type: ignore
                    except Exception:
                        GENAI_Live_Modality = None  # type: ignore
                if ADK_ResponseModality is None and GENAI_Live_Modality is None:
                    try:
                        # google.genai live Modality fallback
                        from google.genai.live import Modality as GOOGLE_GENAI_Live_Modality  # type: ignore
                    except Exception:
                        GOOGLE_GENAI_Live_Modality = None  # type: ignore
                if ADK_ResponseModality is None and GENAI_Live_Modality is None:
                    try:
                        # google.genai.types Modality (fallback)
                        from google.genai.types import Modality as GENAI_Types_Modality  # type: ignore
                    except Exception:
                        GENAI_Types_Modality = None  # type: ignore

                modalities = None
                # Choose the first available enum provider
                if ADK_ResponseModality is not None:
                    try:
                        modalities = [ADK_ResponseModality.TEXT]
                    except Exception:
                        modalities = None
                if modalities is None and GENAI_Live_Modality is not None:
                    try:
                        modalities = [GENAI_Live_Modality.TEXT]
                    except Exception:
                        modalities = None
                if modalities is None and GOOGLE_GENAI_Live_Modality is not None:
                    try:
                        modalities = [GOOGLE_GENAI_Live_Modality.TEXT]
                    except Exception:
                        modalities = None
                if modalities is None and GENAI_Types_Modality is not None:
                    try:
                        modalities = [GENAI_Types_Modality.TEXT]
                    except Exception:
                        modalities = None
                # Validate that the modality is a real enum (not a plain string). If not, fallback to string ["TEXT"].
                modalities_valid = False
                modalities_source = "enum"
                if isinstance(modalities, list) and modalities:
                    m0 = modalities[0]
                    try:
                        modalities_valid = hasattr(m0, "name") and not isinstance(m0, str)
                    except Exception:
                        modalities_valid = False
                if not modalities_valid:
                    modalities = ["TEXT"]
                    modalities_source = "string"
                    try:
                        bridge_log.warning("modality_enum_unavailable; forcing string ['TEXT']")
                    except Exception:
                        pass

                try:
                    # Admit both JPEG stills and audio PCM; keep legacy video/webm entry to be permissive
                    adk_run_config = ADK_RunConfig(
                        streaming_mode=ADK_StreamingMode.BIDI,
                        response_modalities=modalities,  # type: ignore[arg-type]
                        realtime_input_config={
                            "image": {"mime_type": "image/jpeg"},
                            "video": {"mime_type": "video/webm;codecs=vp8,opus"},
                            "audio": {"mime_type": "audio/pcm;rate=16000"},
                        },
                        # Enable input audio transcription per reference implementation
                        input_audio_transcription={},
                    )
                except Exception:
                    adk_run_config = None
                if adk_run_config is not None:
                    try:
                        bridge_log.info("run_config_constructed provider=google.adk.agents.run_config")
                        # Also log value names if enums are used
                        try:
                            sm_name = getattr(getattr(adk_run_config, "streaming_mode", None), "name", None)
                            rms = getattr(adk_run_config, "response_modalities", []) or []
                            rm_names = []
                            for m in rms:
                                try:
                                    rm_names.append(getattr(m, "name", str(m)))
                                except Exception:
                                    rm_names.append(str(m))
                            bridge_log.info(
                                "run_config_values streaming_mode_name=%s response_modalities_names=%s source=%s",
                                sm_name if sm_name is not None else "None",
                                ",".join(rm_names) if rm_names else "<none>",
                                modalities_source,
                            )
                        except Exception:
                            pass
                    except Exception:
                        pass
            except Exception:
                adk_run_config = None
                try:
                    bridge_log.info("run_config_unavailable: using defaults for live attach")
                except Exception:
                    pass

            # First: explicit attach to run_live using exact signature from logs
            events_iter: Optional[AsyncIterator[Any]] = None
            try:
                run_live_fn = getattr(self._runner, "run_live", None)
                if callable(run_live_fn):
                    explicit_kwargs = {"live_request_queue": self._live_q}
                    if adk_run_config is not None:
                        explicit_kwargs["run_config"] = adk_run_config
                        try:
                            bridge_log.info(
                                "run_config_applied keys=%s",
                                list(getattr(adk_run_config, "__dict__", {}).keys()),
                            )
                        except Exception:
                            pass
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
                                "live_attach method=run_live args=0 kwargs=%s iterator_type=%s",
                                list(explicit_kwargs.keys()),
                                type(result).__name__,
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
                # Log concrete RunConfig types for diagnostics
                try:
                    if adk_run_config is not None:
                        sm = getattr(adk_run_config, "streaming_mode", None)
                        rms = getattr(adk_run_config, "response_modalities", None)
                        sm_type = type(sm).__name__ if sm is not None else "None"
                        rm_types = (
                            [type(x).__name__ for x in (rms or [])]
                            if isinstance(rms, list)
                            else []
                        )
                        bridge_log.info(
                            "run_config_types streaming_mode=%s response_modalities_types=%s",
                            sm_type,
                            ",".join(rm_types),
                        )
                except Exception:
                    pass
                # After successful attach, send one-time system message via live queue
                try:
                    if getattr(self, "_sent_system_message", False) is False and self._live_q is not None:
                        # Prefer ADK types; fallback to genai types
                        adk_types = None
                        try:
                            from google.adk import types as adk_types  # type: ignore
                        except Exception:
                            adk_types = None
                        from google.genai import types as genai_types  # type: ignore
                        sys_text = (
                            "You are a helpful shopping assistant. "
                            "Describe what you can infer from incoming screen frames and "
                            "answer the user's question clearly in text."
                        )
                        sys_content = None
                        if adk_types is not None:
                            try:
                                sys_content = adk_types.Content(role="system", parts=[adk_types.Part(text=sys_text)])
                            except Exception:
                                sys_content = None
                        if sys_content is None:
                            try:
                                sys_content = genai_types.Content(role="system", parts=[genai_types.Part(text=sys_text)])
                            except Exception:
                                sys_content = None
                        if sys_content is not None:
                            # Prefer send_realtime; fallback to other method names
                            sent = False
                            for name in ("send_realtime", "send", "enqueue", "put", "write"):
                                fn = getattr(self._live_q, name, None)
                                if not callable(fn):
                                    continue
                                try:
                                    await self._maybe_await(fn(sys_content))  # type: ignore[misc]
                                    bridge_log.info("system_instruction_sent len=%s via=%s", len(sys_text), name)
                                    sent = True
                                    break
                                except Exception:
                                    continue
                            if not sent:
                                bridge_log.warning("system_instruction_send_failed: no compatible live queue method")
                            self._sent_system_message = True  # type: ignore[attr-defined]
                except Exception:
                    pass

            first_event_logged = False
            async for event in events_iter:
                # Brief diagnostics on first few events to aid shape discovery
                if self._diag_events_remaining > 0:
                    try:
                        if isinstance(event, dict):
                            # Lightweight keys and a small preview of likely text fields
                            preview_text = None
                            if isinstance(event.get("text"), str):
                                preview_text = event.get("text")[:40]
                            elif isinstance(event.get("output_text_delta"), dict):
                                t = event["output_text_delta"].get("text") or event["output_text_delta"].get("delta")
                                if isinstance(t, str):
                                    preview_text = t[:40]
                            keys_list = list(event.keys())[:8]
                            bridge_log.debug("event_diag keys=%s preview=%s", keys_list, preview_text)
                            # Record for idle diagnostics
                            try:
                                self._recent_event_keys.append(keys_list)
                                if len(self._recent_event_keys) > 5:
                                    self._recent_event_keys = self._recent_event_keys[-5:]
                            except Exception:
                                pass
                        else:
                            bridge_log.debug(
                                "event_diag type=%s has_output=%s",
                                type(event).__name__,
                                hasattr(event, "output"),
                            )
                    except Exception:
                        pass
                    self._diag_events_remaining -= 1
                # Extract any text pieces and enqueue them
                extracted = self._extract_text(event)
                if not extracted:
                    try:
                        bridge_log.debug("event_no_text_extracted")
                    except Exception:
                        pass
                if not first_event_logged:
                    try:
                        if isinstance(event, dict):
                            bridge_log.info("first_event keys=%s", list(event.keys())[:8])
                        else:
                            bridge_log.info("first_event type=%s", type(event).__name__)
                    except Exception:
                        pass
                    first_event_logged = True
                for piece in extracted:
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
            # Provide the model clear instructions even in non-live mode
            instruction_text = (
                "You are a helpful shopping assistant. "
                "Describe what you can infer from incoming screen frames and "
                "answer the user's question clearly in text."
            )
            prefixed_text = f"{instruction_text}\n\nUser: {self._last_user_text}"
            # Prepare message shapes based on ADK docs: prefer a conversation list
            run_async = getattr(self._runner, "run_async", None)
            if callable(run_async):
                try:
                    # Build types.Content messages per ADK signature
                    from google.genai import types as genai_types  # type: ignore
                    user_content = genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=self._last_user_text)],
                    )
                    new_message = genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=prefixed_text)],
                    )
                    # Prefer providing run_config to enforce TEXT output (even though it's non-live)
                    run_cfg = None
                    try:
                        from google.adk.agents.run_config import (
                            RunConfig as ADK_RunConfig,
                            StreamingMode as ADK_StreamingMode,
                        )  # type: ignore
                        try:
                            from google.adk.agents.run_config import (
                                ResponseModality as ADK_ResponseModality,
                            )  # type: ignore
                        except Exception:
                            ADK_ResponseModality = None  # type: ignore
                        modalities = None
                        if ADK_ResponseModality is not None:
                            try:
                                modalities = [ADK_ResponseModality.TEXT]
                            except Exception:
                                modalities = None
                        if modalities is None:
                            modalities = ["TEXT"]
                        run_cfg = ADK_RunConfig(
                            streaming_mode=ADK_StreamingMode.NONE,
                            response_modalities=modalities,  # type: ignore[arg-type]
                        )
                    except Exception:
                        run_cfg = None
                    # Helper to collect text from various result shapes
                    async def _collect_text_from_result(result_obj: Any) -> str:
                        try:
                            # Direct async-iterable
                            if isinstance(result_obj, (AsyncIterator, AsyncIterable)) or hasattr(result_obj, "__aiter__"):
                                collected: list[str] = []
                                async for event in result_obj:  # type: ignore[operator]
                                    try:
                                        pieces = self._extract_text(event)
                                    except Exception:
                                        pieces = []
                                    if pieces:
                                        collected.extend(pieces)
                                return "".join(collected).strip()
                            # Await coroutines to materialize result
                            if inspect.isawaitable(result_obj):
                                try:
                                    result_obj = await result_obj  # type: ignore[assignment]
                                except Exception:
                                    return ""
                            # Try common sub-attributes that are async-iterables
                            for attr_name in ("events", "stream", "responses", "outputs"):
                                try:
                                    candidate = getattr(result_obj, attr_name, None)
                                except Exception:
                                    candidate = None
                                if candidate is not None and (
                                    isinstance(candidate, (AsyncIterator, AsyncIterable)) or hasattr(candidate, "__aiter__")
                                ):
                                    collected_sub: list[str] = []
                                    try:
                                        async for event in candidate:  # type: ignore[operator]
                                            try:
                                                pieces = self._extract_text(event)
                                            except Exception:
                                                pieces = []
                                            if pieces:
                                                collected_sub.extend(pieces)
                                    except Exception:
                                        pass
                                    if collected_sub:
                                        return "".join(collected_sub).strip()
                            # Finally, attempt direct extraction
                            pieces = self._extract_text(result_obj)
                            return "".join(pieces).strip()
                        except Exception:
                            return ""

                    # Identity strictly per run_async signature: user_id + session_id
                    base_identity: dict[str, Any] = {
                        "user_id": self._user_id,
                        "session_id": self._session_id,
                    }

                    # Attempt shapes in order per printed signature: single new_message only
                    attempts: list[dict[str, Any]] = [
                        {"payload": {"new_message": user_content}, "label": "single:new_message_user_only"},
                        {"payload": {"new_message": new_message}, "label": "single:new_message_prefixed"},
                    ]

                    # Optionally include run_config
                    if run_cfg is not None:
                        for attempt in attempts:
                            attempt["payload"]["run_config"] = run_cfg

                    # Add identity to each attempt
                    for attempt in attempts:
                        attempt["payload"].update(base_identity)

                    # Log signature once for diagnostics
                    try:
                        sig = None
                        try:
                            sig = str(inspect.signature(run_async))
                        except Exception:
                            sig = "unknown"
                        logging.getLogger("adk.bridge").info("runner_signature run_async%s", sig)
                    except Exception:
                        pass

                    # Execute attempts in order
                    for attempt in attempts:
                        try:
                            logging.getLogger("adk.bridge").info(
                                "fallback_run_async_started payload_shape=%s",
                                attempt.get("label"),
                            )
                        except Exception:
                            pass
                        try:
                            res = run_async(**attempt["payload"])  # type: ignore[misc]
                        except TypeError as exc:
                            try:
                                logging.getLogger("adk.bridge").info(
                                    "fallback_call_failed shape=%s err=%s",
                                    attempt.get("label"),
                                    str(exc),
                                )
                            except Exception:
                                pass
                            continue
                        except Exception as exc:
                            try:
                                logging.getLogger("adk.bridge").warning(
                                    "fallback_call_failed shape=%s err=%s",
                                    attempt.get("label"),
                                    str(exc),
                                )
                            except Exception:
                                pass
                            continue

                        text = await _collect_text_from_result(res)
                        try:
                            logging.getLogger("adk.bridge").info("fallback_text_len=%s", len(text))
                        except Exception:
                            pass
                        if text:
                            return text
                except Exception:
                    pass
            # Fallback to sync run
            run_sync = getattr(self._runner, "run", None)
            if callable(run_sync):
                try:
                    from google.genai import types as genai_types  # type: ignore
                    user_content = genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=self._last_user_text)],
                    )
                    new_message = genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=prefixed_text)],
                    )

                    # Identity strictly per run() common signature: user_id + session_id
                    base_identity_sync: dict[str, Any] = {
                        "user_id": self._user_id,
                        "session_id": self._session_id,
                    }

                    sync_attempts: list[dict[str, Any]] = [
                        {"payload": {"new_message": user_content}, "label": "single:new_message_user_only"},
                        {"payload": {"new_message": new_message}, "label": "single:new_message_prefixed"},
                    ]

                    for attempt in sync_attempts:
                        attempt["payload"].update(base_identity_sync)
                        try:
                            logging.getLogger("adk.bridge").info(
                                "fallback_run_sync_started payload_shape=%s",
                                attempt.get("label"),
                            )
                        except Exception:
                            pass
                        try:
                            res = run_sync(**attempt["payload"])  # type: ignore[misc]
                        except TypeError as exc:
                            try:
                                logging.getLogger("adk.bridge").info(
                                    "fallback_call_failed shape=%s err=%s",
                                    attempt.get("label"),
                                    str(exc),
                                )
                            except Exception:
                                pass
                            continue
                        except Exception as exc:
                            try:
                                logging.getLogger("adk.bridge").warning(
                                    "fallback_call_failed shape=%s err=%s",
                                    attempt.get("label"),
                                    str(exc),
                                )
                            except Exception:
                                pass
                            continue

                        pieces = self._extract_text(res)
                        text = "".join(pieces).strip()
                        try:
                            logging.getLogger("adk.bridge").info("fallback_text_len=%s", len(text))
                        except Exception:
                            pass
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
                # Some builds use alt keys
                for alt_key in ("outputText", "final_text", "generated_text", "completion"):
                    try:
                        val = event.get(alt_key)
                        if isinstance(val, str):
                            chunks.append(val)
                    except Exception:
                        pass
                # Popular delta aliases
                ot = event.get("output_text_delta")
                if isinstance(ot, dict):
                    t = ot.get("text") or ot.get("delta")
                    if isinstance(t, str):
                        chunks.append(t)
                td = event.get("textDelta")
                if isinstance(td, (str, dict)):
                    t = td if isinstance(td, str) else td.get("text") or td.get("delta")
                    if isinstance(t, str):
                        chunks.append(t)
                d = event.get("delta")
                if isinstance(d, dict):
                    t = d.get("text")
                    if isinstance(t, str):
                        chunks.append(t)
                sc = event.get("serverContent") or event.get("server_content")
                if sc:
                    parts = sc.get("modelTurn", {}).get("parts") or sc.get("parts")
                    if isinstance(parts, list):
                        for p in parts:
                            t = (p or {}).get("text")
                            if isinstance(t, str):
                                chunks.append(t)
                # ADK output-like shapes
                out = event.get("output") or event.get("server_output")
                if out:
                    if isinstance(out.get("text"), str):
                        chunks.append(str(out.get("text")))
                    # candidates[].content.parts[].text
                    cands = out.get("candidates") or []
                    for c in cands:
                        content = (c or {}).get("content") or {}
                        parts = content.get("parts") or []
                        for p in parts:
                            t = (p or {}).get("text")
                            if isinstance(t, str):
                                chunks.append(t)
                    # direct parts[].text
                    parts = out.get("parts") or []
                    for p in parts:
                        t = (p or {}).get("text")
                        if isinstance(t, str):
                            chunks.append(t)
                # Some responses embed a message/response wrapper
                msg = event.get("message") or event.get("response")
                if isinstance(msg, dict):
                    try:
                        t = msg.get("text")
                        if isinstance(t, str):
                            chunks.append(t)
                    except Exception:
                        pass
            else:
                # Object-like events: try attributes
                t = getattr(event, "text", None)
                if isinstance(t, str):
                    chunks.append(t)
                output = getattr(event, "output", None)
                if output is not None:
                    ot = getattr(event, "output_text_delta", None)
                    if ot is not None:
                        try:
                            tt = getattr(ot, "text", None) or getattr(ot, "delta", None)
                            if isinstance(tt, str):
                                chunks.append(tt)
                        except Exception:
                            pass
                    parts = getattr(output, "parts", None) or getattr(output, "contents", None)
                    if isinstance(parts, list):
                        for p in parts:
                            pt = getattr(p, "text", None) if hasattr(p, "text") else None
                            if isinstance(pt, str):
                                chunks.append(pt)
                    # candidates[].content.parts[].text
                    candidates = getattr(output, "candidates", None)
                    if isinstance(candidates, list):
                        for c in candidates:
                            content = getattr(c, "content", None)
                            parts = getattr(content, "parts", None) if content is not None else None
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


