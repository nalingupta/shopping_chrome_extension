"""
Probe multiple models in one go to isolate model/entitlement issues.

Runs two kinds of checks:
  - ADK run_async text check (expects some text back)
  - For native-audio models, a google.genai Live AUDIO check (expects audio bytes)

Usage:
  python -m server.app.probe_models

Env overrides:
  PROBE_MODELS: comma-separated list of model ids
  PROJECT_ID / LOCATION: to construct Vertex model URIs if needed
  GOOGLE_API_KEY / GEMINI_API_KEY: for genai Live; ADK may require Vertex creds
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, AsyncIterable, AsyncIterator


DEFAULT_MODELS = [
    # Live/half-cascade
    "gemini-live-2.5-flash-preview",
    "models/gemini-live-2.5-flash-preview",
    "gemini-2.0-flash-live-001",
    "models/gemini-2.0-flash-live-001",
    # Text
    "gemini-2.0-flash-exp",
    "models/gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "models/gemini-1.5-flash",
    "gemini-1.5-pro",
    "models/gemini-1.5-pro",
    # Native audio output
    "gemini-2.5-flash-preview-native-audio-dialog",
    "gemini-2.5-flash-exp-native-audio-thinking-dialog",
]


async def adk_run_async_text(model: str) -> tuple[str, str]:
    """Return (status, preview_text). status in {OK, EMPTY, ERROR}."""
    try:
        from importlib import import_module
        agents = import_module("google.adk.agents")
        runners = import_module("google.adk.runners")
        types = import_module("google.genai.types")
        Agent = getattr(agents, "Agent")
        InMemoryRunner = getattr(runners, "InMemoryRunner", None)
        Runner = InMemoryRunner or getattr(runners, "Runner")
        # Build Agent; explicitly pass API key if present for AI Studio path
        # ADK AI Studio mode: do NOT pass api_key in constructor; rely on env per docs
        try:
            agent = Agent(name="probe", model=model, instructions="Reply concisely.")  # type: ignore
        except Exception:
            agent = Agent(name="probe", model=model)  # type: ignore
        runner = Runner(agent=agent, app_name="probe_models")  # type: ignore
        new_msg = types.Content(role="user", parts=[types.Part(text="hello")])
        res = runner.run_async(user_id="probe", session_id="s", new_message=new_msg)  # type: ignore[misc]
        text = await _collect_text(res)
        if text:
            return ("OK", text[:120])
        return ("EMPTY", "")
    except Exception as exc:
        return ("ERROR", str(exc))


async def genai_live_audio_probe(model: str) -> tuple[str, str]:
    """Return (status, detail). status in {AUDIO_OK, AUDIO_EMPTY, AUDIO_ERROR}."""
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
        api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        client = genai.Client(api_key=api_key)  # explicit to avoid env pickup issues
        # Build 200ms of 16kHz PCM16 silence
        import array
        samples = 16000 // 5
        pcm16 = array.array("h", [0] * samples).tobytes()

        async with client.aio.live.connect(model=model, config={"response_modalities": ["AUDIO"]}) as session:
            await session.send_realtime_input(
                audio=types.Blob(data=pcm16, mime_type="audio/pcm;rate=16000")
            )
            # Bounded wait for audio frames
            gen = session.receive()
            attempts = 3
            per_attempt_timeout = 3.0
            for _ in range(attempts):
                try:
                    resp = await asyncio.wait_for(gen.__anext__(), timeout=per_attempt_timeout)
                except asyncio.TimeoutError:
                    continue
                if getattr(resp, "data", None):
                    return ("AUDIO_OK", "received data")
            return ("AUDIO_EMPTY", "no data within timeout")
    except Exception as exc:
        return ("AUDIO_ERROR", str(exc))


async def _collect_text(result_obj: Any) -> str:
    try:
        if isinstance(result_obj, (AsyncIterator, AsyncIterable)) or hasattr(result_obj, "__aiter__"):
            parts: list[str] = []
            async for ev in result_obj:  # type: ignore[operator]
                parts.extend(_extract_text(ev))
            return "".join(parts).strip()
        if asyncio.iscoroutine(result_obj):
            result_obj = await result_obj  # type: ignore[assignment]
        for attr in ("events", "stream", "responses", "outputs"):
            candidate = getattr(result_obj, attr, None)
            if candidate is not None and (
                isinstance(candidate, (AsyncIterator, AsyncIterable)) or hasattr(candidate, "__aiter__")
            ):
                parts: list[str] = []
                async for ev in candidate:  # type: ignore[operator]
                    parts.extend(_extract_text(ev))
                return "".join(parts).strip()
        return "".join(_extract_text(result_obj)).strip()
    except Exception:
        return ""


def _extract_text(event: Any) -> list[str]:
    chunks: list[str] = []
    try:
        if isinstance(event, dict):
            if isinstance(event.get("text"), str):
                chunks.append(str(event["text"]))
            otd = event.get("output_text_delta")
            if isinstance(otd, dict):
                t = otd.get("text") or otd.get("delta")
                if isinstance(t, str):
                    chunks.append(t)
            sc = event.get("serverContent") or event.get("server_content")
            if sc:
                parts = (sc.get("modelTurn", {}) or {}).get("parts") or sc.get("parts") or []
                if isinstance(parts, list):
                    for p in parts:
                        t = (p or {}).get("text")
                        if isinstance(t, str):
                            chunks.append(t)
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
    models_env = os.getenv("PROBE_MODELS")
    models = [m.strip() for m in models_env.split(",") if m.strip()] if models_env else DEFAULT_MODELS

    print("=== PROBE RESULTS ===")
    for m in models:
        if "native-audio" in m:
            status, detail = await genai_live_audio_probe(m)
            print(f"{m:50s} | {status:12s} | {detail}")
        else:
            status, preview = await adk_run_async_text(m)
            print(f"{m:50s} | {status:12s} | {preview}")


if __name__ == "__main__":
    asyncio.run(main())


