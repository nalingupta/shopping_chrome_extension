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


async def generate_live_audio_response(
    audio_input: Optional[bytes] = None,
    audio_file_path: Optional[str] = None,
    transcript_text: Optional[str] = None,
    system_prompt: str = DEFAULT_AUDIO_SYSTEM_PROMPT,
    response_modalities: list[str] = None,
    output_audio_path: Optional[str] = None
) -> AudioTextResponse:
    """Generate response using Gemini Live with native audio dialog.
    
    Args:
        audio_input: Raw audio bytes in PCM format (16kHz, 16-bit)
        audio_file_path: Path to audio file (will be converted to PCM)
        transcript_text: Optional text transcript
        system_prompt: System instruction for the model
        response_modalities: List of response types ["TEXT", "AUDIO"]
        output_audio_path: Optional path to save output audio file
        
    Returns:
        AudioTextResponse with text and/or audio data
    """
    if response_modalities is None:
        response_modalities = ["TEXT", "AUDIO"]
    
    client = _client()
    
    # Use the native audio output model
    model = "gemini-2.5-flash-preview-native-audio-dialog"
    
    # Create config dictionary as shown in documentation
    config = {"response_modalities": response_modalities}
    
    try:
        async with client.aio.live.connect(model=model, config=config) as session:
            # Prepare the main user message combining system prompt and user input
            user_message = system_prompt
            if transcript_text:
                user_message += f"\n\nUser: {transcript_text}"
            
            # Prepare audio input
            audio_bytes = None
            if audio_input:
                audio_bytes = audio_input
            elif audio_file_path and os.path.exists(audio_file_path):
                # Convert audio file to PCM format
                buffer = io.BytesIO()
                y, sr = librosa.load(audio_file_path, sr=16000)
                sf.write(buffer, y, sr, format='RAW', subtype='PCM_16')
                buffer.seek(0)
                audio_bytes = buffer.read()
            
            # Send input - prefer audio if available, otherwise text
            if audio_bytes:
                await session.send_realtime_input(
                    audio=types.Blob(data=audio_bytes, mime_type="audio/pcm;rate=16000")
                )
                # Also send text context if available
                if user_message.strip():
                    await session.send_realtime_input(text=user_message)
            else:
                # Text-only input
                if user_message.strip():
                    await session.send_realtime_input(text=user_message)
                else:
                    await session.send_realtime_input(text="Please provide shopping assistance.")
            
            # Collect response
            response_text = ""
            audio_data = b""
            
            # Setup audio file writer if audio response is expected
            wf = None
            if "AUDIO" in response_modalities and output_audio_path:
                wf = wave.open(output_audio_path, "wb")
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)  # Output is 24kHz
            
            try:
                async for response in session.receive():
                    # Collect audio data
                    if hasattr(response, 'data') and response.data is not None:
                        audio_data += response.data
                        if wf:
                            wf.writeframes(response.data)
                    
                    # Collect text response
                    if hasattr(response, 'text') and response.text is not None:
                        response_text += response.text
            finally:
                if wf:
                    wf.close()
            
            return AudioTextResponse(
                text=response_text,
                audio_data=audio_data,
                audio_format="wav",
                sample_rate=24000
            )
            
    except Exception as e:
        print(f"Error in generate_live_audio_response: {e}")
        # Fallback to text-only response using existing method
        fallback_text = ""
        if transcript_text:
            fallback_text = generate_audio_response(None, transcript_text, system_prompt)
        elif audio_file_path:
            fallback_text = generate_audio_response(audio_file_path, None, system_prompt)
        
        return AudioTextResponse(text=fallback_text)


async def generate_live_multimodal_response(
    video_path: Optional[str] = None,
    audio_input: Optional[bytes] = None,
    audio_file_path: Optional[str] = None,
    transcript_text: Optional[str] = None,
    system_prompt: str = DEFAULT_AUDIO_SYSTEM_PROMPT,
    response_modalities: list[str] = None,
    output_audio_path: Optional[str] = None
) -> AudioTextResponse:
    """Generate multimodal response with video/audio input and text/audio output.
    
    This function combines video analysis with live audio conversation capabilities.
    
    Args:
        video_path: Path to video file for analysis
        audio_input: Raw audio bytes for conversation
        audio_file_path: Path to audio file for conversation
        transcript_text: Optional text transcript
        system_prompt: System instruction
        response_modalities: Response types ["TEXT", "AUDIO"]
        output_audio_path: Path to save audio response
        
    Returns:
        AudioTextResponse with combined analysis and conversation
    """
    if response_modalities is None:
        response_modalities = ["TEXT", "AUDIO"]
    
    # First, analyze video if provided using existing method
    video_analysis = ""
    if video_path:
        video_analysis = generate_video_response(video_path, transcript_text, system_prompt)
    
    # Then use live audio for conversational response
    enhanced_prompt = system_prompt
    if video_analysis:
        enhanced_prompt = f"{system_prompt}\n\nContext from video analysis: {video_analysis}"
    
    return await generate_live_audio_response(
        audio_input=audio_input,
        audio_file_path=audio_file_path,
        transcript_text=transcript_text,
        system_prompt=enhanced_prompt,
        response_modalities=response_modalities,
        output_audio_path=output_audio_path
    )


def save_audio_response(audio_data: bytes, output_path: str, sample_rate: int = 24000) -> bool:
    """Save audio response data to a WAV file.
    
    Args:
        audio_data: Raw audio bytes
        output_path: Path to save the audio file
        sample_rate: Sample rate of the audio (default 24kHz)
        
    Returns:
        True if successful, False otherwise
    """
    try:
        with wave.open(output_path, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(audio_data)
        return True
    except Exception as e:
        print(f"Error saving audio: {e}")
        return False


# Example usage function
async def example_usage():
    """Example of how to use the new Gemini Live audio capabilities."""
    
    # Example 1: Audio-only conversation with both text and audio response
    response = await generate_live_audio_response(
        transcript_text="What are the best deals on laptops today?",
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="response_audio.wav"
    )
    
    print(f"Text response: {response.text}")
    print(f"Audio data length: {len(response.audio_data)} bytes")
    
    # Example 2: Audio file input with audio output
    response = await generate_live_audio_response(
        audio_file_path="user_question.wav",
        response_modalities=["TEXT", "AUDIO"]
    )
    
    # Save audio response separately if needed
    if response.audio_data:
        save_audio_response(response.audio_data, "assistant_response.wav")
    
    # Example 3: Combined video analysis + audio conversation
    multimodal_response = await generate_live_multimodal_response(
        video_path="shopping_session.webm",
        transcript_text="Can you help me find similar products?",
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="multimodal_response.wav"
    )
    
    print(f"Multimodal response: {multimodal_response.text}")


if __name__ == "__main__":
    # Run example usage
    asyncio.run(example_usage())
