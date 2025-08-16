from __future__ import annotations

from typing import Optional

import os
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types

from .prompts import build_prompt, GENERIC_ASSISTANT_PROMPT


_CLIENT: genai.Client | None = None


def _client() -> genai.Client:
    global _CLIENT
    if _CLIENT is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            # Attempt to load from server/.env relative to this file, without overriding existing env
            env_path = Path(__file__).resolve().parent / ".env"
            try:
                load_dotenv(dotenv_path=env_path, override=False)
                api_key = os.getenv("GEMINI_API_KEY")
            except Exception:
                api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            _CLIENT = genai.Client(api_key=api_key)
        else:
            # Construct without key; downstream calls will fail cleanly and return empty string
            _CLIENT = genai.Client()
    return _CLIENT


# Legacy compatibility - use the new XML-based prompt system
DEFAULT_SYSTEM_PROMPT = GENERIC_ASSISTANT_PROMPT


def generate_video_response(
    video_path: Optional[str],
    transcript_text: Optional[str],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> str:
    """Calls Gemini 2.5 Flash with optional video + transcript and returns response text.

    If the video cannot be attached or the call fails, it falls back to text-only using the transcript.
    """
    # Build structured XML prompt
    user_input = f"User query/transcript: {transcript_text}" if transcript_text else None
    prompt = build_prompt(user_input=user_input, system_prompt=system_prompt)

    client = _client()

    # Try multimodal first if video is available
    if video_path:
        try:
            with open(video_path, "rb") as f:
                video_bytes = f.read()
            contents = [
                types.Part(text=prompt),
            ]
            contents.append(
                types.Part(
                    inline_data=types.Blob(mime_type="video/webm", data=video_bytes)
                )
            )
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
            )
            return getattr(resp, "text", "") or ""
        except Exception:
            # Fall back to text-only
            pass

    # Text-only fallback
    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return getattr(resp, "text", "") or ""
    except Exception:
        return ""


def generate_image_response(
    image_bytes: Optional[bytes],
    transcript_text: Optional[str],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> str:
    """Calls Gemini 2.5 Flash with a single image + optional text and returns response text.

    If the image cannot be attached or the call fails, it falls back to text-only using the transcript.
    """
    # Build structured XML prompt
    user_input = f"User query/transcript: {transcript_text}" if transcript_text else None
    prompt = build_prompt(user_input=user_input, system_prompt=system_prompt)

    client = _client()

    if image_bytes:
        try:
            contents = [types.Part(text=prompt)]
            contents.append(
                types.Part(
                    inline_data=types.Blob(mime_type="image/jpeg", data=image_bytes)
                )
            )
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
            )
            return getattr(resp, "text", "") or ""
        except Exception:
            pass

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return getattr(resp, "text", "") or ""
    except Exception:
        return ""


def generate_audio_response(
    audio_wav_path: Optional[str],
    transcript_text: Optional[str],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> str:
    """Calls Gemini 2.5 Flash with audio (WAV) + optional transcript, falling back to text-only if needed."""
    # Build structured XML prompt
    user_input = f"User query/transcript: {transcript_text}" if transcript_text else None
    prompt = build_prompt(user_input=user_input, system_prompt=system_prompt)

    client = _client()

    if audio_wav_path:
        try:
            with open(audio_wav_path, "rb") as f:
                audio_bytes = f.read()
            contents = [types.Part(text=prompt)]
            contents.append(
                types.Part(
                    inline_data=types.Blob(mime_type="audio/wav", data=audio_bytes)
                )
            )
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
            )
            return getattr(resp, "text", "") or ""
        except Exception:
            pass

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return getattr(resp, "text", "") or ""
    except Exception:
        return ""


