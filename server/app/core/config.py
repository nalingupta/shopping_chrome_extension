"""
Application configuration settings.
"""
import os
from typing import List

from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    """Application settings."""
    
    # Basic app info
    PROJECT_NAME: str = "Shopping Chrome Extension Server"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = int(os.getenv("PORT", "8000"))  # Railway sets PORT automatically
    DEBUG: bool = False
    
    # CORS settings
    ALLOWED_ORIGINS: List[str] = ["*"]
    ALLOWED_METHODS: List[str] = ["*"]
    ALLOWED_HEADERS: List[str] = ["*"]
    
    # Logging
    LOG_LEVEL: str = "INFO"
    
    # VAD settings
    VAD_SAMPLE_RATE: int = 16000
    VAD_FRAME_MS: int = 30
    VAD_MIN_SPEECH_MS: int = 300
    VAD_END_SILENCE_MS: int = 800
    VAD_PRE_ROLL_MS: int = 200
    VAD_POST_ROLL_MS: int = 300
    VAD_AMPLITUDE_THRESHOLD: float = 0.02
    
    # Buffer limits
    MAX_FRAMES_BUFFER: int = 5000
    MAX_AUDIO_CHUNKS: int = 5000
    
    # External APIs
    GEMINI_API_KEY: str = ""
    
    # Media processing settings (optional)
    CAPTURE_FPS: float = 1.0
    ENCODE_FPS: float = 2.0
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Ignore extra fields in .env


settings = Settings()
