"""
Gemini AI service for generating responses from video, audio, and text content.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import google.generativeai as genai

from ..core.logging import get_logger

logger = get_logger(__name__)


class GeminiService:
    """Service for interacting with Google's Gemini AI model."""
    
    DEFAULT_SYSTEM_PROMPT = (
        "You are a shopping assistant. You receive a short video segment captured from the user's browsing "
        "session along with an optional user transcription. Understand the user's shopping intent and provide "
        "a helpful, concise text response. Respond in plain text only."
    )
    
    def __init__(self):
        self._model = None
        self._initialize_client()
    
    def _initialize_client(self) -> None:
        """Initialize the Gemini client with API key."""
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            # Attempt to load from server/.env
            env_path = Path(__file__).resolve().parent.parent.parent / ".env"
            try:
                load_dotenv(dotenv_path=env_path, override=False)
                api_key = os.getenv("GEMINI_API_KEY")
            except Exception as e:
                logger.warning(f"Failed to load .env file: {e}")
        
        if api_key:
            genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel('gemini-1.5-flash')
            logger.info("Gemini client initialized successfully")
        else:
            logger.warning("No GEMINI_API_KEY found. Gemini responses will be empty.")
    
    @property
    def model(self):
        """Get the Gemini model instance."""
        if self._model is None:
            self._initialize_client()
        return self._model
    
    def generate_video_response(
        self,
        video_path: Optional[str],
        transcript_text: Optional[str],
        system_prompt: str = None,
    ) -> str:
        """
        Generate response from video and optional transcript.
        
        Args:
            video_path: Path to video file (WebM format)
            transcript_text: Optional transcript text
            system_prompt: Custom system prompt (uses default if None)
            
        Returns:
            Generated response text
        """
        prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT
        if transcript_text:
            prompt = f"{prompt}\n\nUser transcription (if any): {transcript_text}"
        
        # Try multimodal first if video is available
        if video_path and os.path.exists(video_path) and self.model:
            try:
                # Upload video file
                video_file = genai.upload_file(video_path)
                
                response = self.model.generate_content([prompt, video_file])
                
                result = response.text if response.text else ""
                logger.info(f"Generated video response: {len(result)} characters")
                return result
                
            except Exception as e:
                logger.warning(f"Video processing failed, falling back to text: {e}")
        
        # Text-only fallback
        return self._generate_text_response(prompt)
    
    def generate_image_response(
        self,
        image_bytes: Optional[bytes],
        transcript_text: Optional[str],
        system_prompt: str = None,
    ) -> str:
        """
        Generate response from image and optional transcript.
        
        Args:
            image_bytes: Image data in bytes (JPEG format)
            transcript_text: Optional transcript text
            system_prompt: Custom system prompt (uses default if None)
            
        Returns:
            Generated response text
        """
        prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT
        if transcript_text:
            prompt = f"{prompt}\n\nUser transcription (if any): {transcript_text}"
        
        if image_bytes and self.model:
            try:
                # Create image part from bytes
                import tempfile
                with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp_file:
                    tmp_file.write(image_bytes)
                    tmp_file.flush()
                    
                    image_file = genai.upload_file(tmp_file.name)
                    response = self.model.generate_content([prompt, image_file])
                    
                    result = response.text if response.text else ""
                    logger.info(f"Generated image response: {len(result)} characters")
                    
                    # Clean up temp file
                    os.unlink(tmp_file.name)
                    return result
                
            except Exception as e:
                logger.warning(f"Image processing failed, falling back to text: {e}")
        
        # Text-only fallback
        return self._generate_text_response(prompt)
    
    def generate_audio_response(
        self,
        audio_wav_path: Optional[str],
        transcript_text: Optional[str],
        system_prompt: str = None,
    ) -> str:
        """
        Generate response from audio and optional transcript.
        
        Args:
            audio_wav_path: Path to audio file (WAV format)
            transcript_text: Optional transcript text
            system_prompt: Custom system prompt (uses default if None)
            
        Returns:
            Generated response text
        """
        prompt = system_prompt or self.DEFAULT_SYSTEM_PROMPT
        if transcript_text:
            prompt = f"{prompt}\n\nUser transcription (if any): {transcript_text}"
        
        if audio_wav_path and os.path.exists(audio_wav_path) and self.model:
            try:
                # Upload audio file
                audio_file = genai.upload_file(audio_wav_path)
                
                response = self.model.generate_content([prompt, audio_file])
                
                result = response.text if response.text else ""
                logger.info(f"Generated audio response: {len(result)} characters")
                return result
                
            except Exception as e:
                logger.warning(f"Audio processing failed, falling back to text: {e}")
        
        # Text-only fallback
        return self._generate_text_response(prompt)
    
    def _generate_text_response(self, prompt: str) -> str:
        """Generate text-only response."""
        try:
            if not self.model:
                logger.warning("No Gemini model available")
                return ""
                
            response = self.model.generate_content(prompt)
            result = response.text if response.text else ""
            logger.info(f"Generated text response: {len(result)} characters")
            return result
        except Exception as e:
            logger.error(f"Text generation failed: {e}")
            return ""


# Global service instance
_gemini_service: GeminiService | None = None


def get_gemini_service() -> GeminiService:
    """Get the global Gemini service instance."""
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service
