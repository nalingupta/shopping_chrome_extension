"""
Standalone probe to validate ADK non-live text generation in the current env.

Usage (from repo root):
  uvicorn server.app.main:app  # (optional, not required for this probe)
  python -m server.app.probe_run_async

Environment variables (optional):
  ADK_PROBE_MODEL   default: models/gemini-2.0-flash-exp
  GOOGLE_API_KEY    or GEMINI_API_KEY must be set for ADK Agent
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import uuid
from typing import Any, AsyncIterable, AsyncIterator


async def _collect_text_from_result(result_obj: Any) -> str:
    """Collect text from runner.run_async result across common shapes."""
    try:
        # Async-iterable of events
        if isinstance(result_obj, (AsyncIterator, AsyncIterable)) or hasattr(result_obj, "__aiter__"):
            collected: list[str] = []
            async for event in result_obj:  # type: ignore[operator]
                pieces = _extract_text(event)
                if pieces:
                    collected.extend(pieces)
            return "".join(collected).strip()
        # Await coroutines to materialize
        if asyncio.iscoroutine(result_obj):
            result_obj = await result_obj  # type: ignore[assignment]
        # Try common sub-attributes that are async-iterables
        for attr in ("events", "stream", "responses", "outputs"):
            try:
                candidate = getattr(result_obj, attr, None)
            except Exception:
                candidate = None
            if candidate is not None and (
                isinstance(candidate, (AsyncIterator, AsyncIterable)) or hasattr(candidate, "__aiter__")
            ):
                collected_sub: list[str] = []
                try:
                    async for ev in candidate:  # type: ignore[operator]
                        collected_sub.extend(_extract_text(ev))
                except Exception:
                    pass
                if collected_sub:
                    return "".join(collected_sub).strip()
        # Direct extraction
        return "".join(_extract_text(result_obj)).strip()
    except Exception:
        return ""


def _extract_text(event: Any) -> list[str]:
    chunks: list[str] = []
    try:
        if isinstance(event, dict):
            if isinstance(event.get("text"), str):
                chunks.append(str(event["text"]))
            # output_text_delta variants
            otd = event.get("output_text_delta")
            if isinstance(otd, dict):
                t = otd.get("text") or otd.get("delta")
                if isinstance(t, str):
                    chunks.append(t)
            # serverContent shapes
            sc = event.get("serverContent") or event.get("server_content")
            if sc:
                parts = (sc.get("modelTurn", {}) or {}).get("parts") or sc.get("parts") or []
                if isinstance(parts, list):
                    for p in parts:
                        t = (p or {}).get("text")
                        if isinstance(t, str):
                            chunks.append(t)
            # output.candidates[].content.parts[].text
            out = event.get("output") or event.get("server_output")
            if out:
                if isinstance(out.get("text"), str):
                    chunks.append(str(out.get("text")))
                cands = out.get("candidates") or []
                for c in cands:
                    content = (c or {}).get("content") or {}
                    parts = content.get("parts") or []
                    for p in parts:
                        t = (p or {}).get("text")
                        if isinstance(t, str):
                            chunks.append(t)
        else:
            t = getattr(event, "text", None)
            if isinstance(t, str):
                chunks.append(t)
            output = getattr(event, "output", None)
            if output is not None:
                otd = getattr(event, "output_text_delta", None)
                if otd is not None:
                    tt = getattr(otd, "text", None) or getattr(otd, "delta", None)
                    if isinstance(tt, str):
                        chunks.append(tt)
                parts = getattr(output, "parts", None) or getattr(output, "contents", None)
                if isinstance(parts, list):
                    for p in parts:
                        pt = getattr(p, "text", None) if hasattr(p, "text") else None
                        if isinstance(pt, str):
                            chunks.append(pt)
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


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    log = logging.getLogger("adk.probe")

    model = os.getenv("ADK_PROBE_MODEL", "models/gemini-2.0-flash-exp")
    user_id = "probe"
    session_id = uuid.uuid4().hex
    instruction_text = (
        "You are a helpful assistant. Answer the user's question clearly in text."
    )

    # Import ADK Agent/Runner
    from importlib import import_module

    try:
        Agent = import_module("google.adk.agents").Agent  # type: ignore[attr-defined]
        runners = import_module("google.adk.runners")
    except Exception as exc:
        log.error("Failed to import ADK modules: %s", exc)
        sys.exit(1)

    # Construct Agent
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    # Only pass api_key if present; some ADK versions reject unknown/None fields
    if api_key:
        try:
            agent = Agent(  # type: ignore
                name="adk_probe",
                model=model,
                api_key=api_key,
                instructions=instruction_text,
            )
        except Exception:
            agent = Agent(name="adk_probe", model=model, api_key=api_key)  # type: ignore
    else:
        try:
            agent = Agent(name="adk_probe", model=model, instructions=instruction_text)  # type: ignore
        except Exception:
            agent = Agent(name="adk_probe", model=model)  # type: ignore

    # Runner preference
    try:
        Runner = getattr(runners, "InMemoryRunner")  # type: ignore[attr-defined]
        runner = Runner(agent=agent, app_name="adk_probe")  # type: ignore[call-arg]
    except Exception:
        Runner = getattr(runners, "Runner")  # type: ignore[attr-defined]
        runner = Runner(agent=agent, app_name="adk_probe")  # type: ignore[call-arg]

    # Build genai Content
    try:
        genai_types = import_module("google.genai.types")  # type: ignore[attr-defined]
        new_message = genai_types.Content(role="user", parts=[genai_types.Part(text="hello")])
    except Exception:
        new_message = "hello"

    # Optional RunConfig with NONE streaming
    run_config = None
    try:
        rc_mod = import_module("google.adk.agents.run_config")
        ADK_RunConfig = getattr(rc_mod, "RunConfig")
        ADK_StreamingMode = getattr(rc_mod, "StreamingMode")
        # Try to set TEXT modality if available
        modalities = None
        try:
            ADK_ResponseModality = getattr(rc_mod, "ResponseModality")
            modalities = [getattr(ADK_ResponseModality, "TEXT")]
        except Exception:
            modalities = None
        try:
            run_config = ADK_RunConfig(streaming_mode=getattr(ADK_StreamingMode, "NONE"), response_modalities=modalities)
        except Exception:
            run_config = ADK_RunConfig(streaming_mode=getattr(ADK_StreamingMode, "NONE"))
    except Exception:
        run_config = None

    # Call run_async
    try:
        kwargs: dict[str, Any] = {"user_id": user_id, "session_id": session_id, "new_message": new_message}
        if run_config is not None:
            kwargs["run_config"] = run_config
        res = runner.run_async(**kwargs)  # type: ignore[misc]
        text = await _collect_text_from_result(res)
        print("=== ADK run_async text ===\n" + (text or "<empty>"))
    except Exception as exc:
        log.error("run_async failed: %s", exc)
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())


