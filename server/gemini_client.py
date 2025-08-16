from __future__ import annotations

from typing import Optional, Dict, Any, AsyncGenerator, Tuple
from dataclasses import dataclass

import os
import io
import asyncio
import wave
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types
import soundfile as sf
import librosa


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


DEFAULT_SYSTEM_PROMPT = (
    "You are a shopping assistant. You receive a short video segment captured from the user's browsing "
    "session along with an optional user transcription. Understand the user's shopping intent and provide "
    "a helpful, concise text response. Respond in plain text only."
)

DEFAULT_AUDIO_SYSTEM_PROMPT = (
    "You are a helpful shopping assistant. Answer in a friendly tone and provide concise, "
    "helpful responses about shopping queries, product recommendations, and browsing assistance."
)

@dataclass
class AudioTextResponse:
    """Response containing both text and audio data."""
    text: str = ""
    audio_data: bytes = b""
    audio_format: str = "wav"
    sample_rate: int = 24000


def generate_video_response(
    video_path: Optional[str],
    transcript_text: Optional[str],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
) -> str:
    """Calls Gemini 2.5 Flash with optional video + transcript and returns response text.

    If the video cannot be attached or the call fails, it falls back to text-only using the transcript.
    """
    prompt = system_prompt
    if transcript_text:
        prompt = f"{system_prompt}\n\nUser transcription (if any): {transcript_text}"

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
    prompt = system_prompt
    if transcript_text:
        prompt = f"{system_prompt}\n\nUser transcription (if any): {transcript_text}"

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
    prompt = system_prompt
    if transcript_text:
        prompt = f"{system_prompt}\n\nUser transcription (if any): {transcript_text}"

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


