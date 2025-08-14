"""
Voice Activity Detection (VAD) utilities for audio processing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from ..core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class VadConfig:
    """Configuration for Voice Activity Detection."""
    frame_ms: int = 30
    min_speech_ms: int = 300
    end_silence_ms: int = 800
    pre_roll_ms: int = 200
    post_roll_ms: int = 300
    amplitude_threshold: float = 0.02  # normalized (0..1) RMS threshold


class RmsVadSegmenter:
    """RMS-based Voice Activity Detection segmenter."""
    
    def __init__(self, sample_rate_hz: int = 16000, cfg: Optional[VadConfig] = None) -> None:
        """
        Initialize VAD segmenter.
        
        Args:
            sample_rate_hz: Audio sample rate in Hz
            cfg: VAD configuration (uses default if None)
        """
        self.cfg = cfg or VadConfig()
        self.sample_rate_hz = sample_rate_hz
        self.logger = logger
        
        # State tracking
        self.state = "idle"  # idle | speaking
        self.speech_ms = 0
        self.silence_ms = 0
        self.first_speech_ts_ms: Optional[float] = None
        self.last_speech_ts_ms: Optional[float] = None
        
        self.logger.debug(
            f"Initialized VAD: sample_rate={sample_rate_hz}Hz, "
            f"threshold={self.cfg.amplitude_threshold}"
        )
    
    def _frame_is_speech(self, pcm_le_int16: bytes) -> bool:
        """
        Determine if audio frame contains speech using RMS amplitude.
        
        Args:
            pcm_le_int16: PCM audio data (16-bit little-endian)
            
        Returns:
            True if frame contains speech, False otherwise
        """
        if not pcm_le_int16:
            return False
        
        # Calculate RMS amplitude
        total = 0
        count = 0
        
        # Process 2 bytes at a time (16-bit samples)
        for i in range(0, len(pcm_le_int16), 2):
            if i + 1 >= len(pcm_le_int16):
                break
            
            # Convert little-endian bytes to signed integer
            sample = int.from_bytes(pcm_le_int16[i:i + 2], "little", signed=True)
            total += abs(sample)
            count += 1
        
        if count == 0:
            return False
        
        # Normalize RMS to 0-1 range
        rms = (total / count) / 32768.0
        is_speech = rms >= self.cfg.amplitude_threshold
        
        if is_speech:
            self.logger.debug(f"Speech detected: RMS={rms:.4f}")
        
        return is_speech
    
    def process_frame(
        self, 
        frame_bytes: bytes, 
        frame_start_ts_ms: float
    ) -> Tuple[Optional[str], Optional[Dict]]:
        """
        Process an audio frame and detect speech segments.
        
        Args:
            frame_bytes: PCM audio frame data
            frame_start_ts_ms: Frame start timestamp in milliseconds
            
        Returns:
            Tuple of (event_type, payload) where:
            - event_type: None | "segment_start" | "segment_end"
            - payload: Event-specific data dictionary
        """
        is_speech = self._frame_is_speech(frame_bytes)
        frame_ms = self.cfg.frame_ms
        
        if is_speech:
            self.speech_ms += frame_ms
            self.silence_ms = 0
            
            if self.state == "idle" and self.speech_ms >= self.cfg.min_speech_ms:
                # Transition to speaking state
                self.state = "speaking"
                
                # Calculate segment start with pre-roll
                self.first_speech_ts_ms = (
                    frame_start_ts_ms - (self.speech_ms - frame_ms) - self.cfg.pre_roll_ms
                )
                if self.first_speech_ts_ms < 0:
                    self.first_speech_ts_ms = 0
                
                self.last_speech_ts_ms = frame_start_ts_ms
                
                payload = {"segment_start_ms": self.first_speech_ts_ms}
                self.logger.info(f"Speech segment started at {self.first_speech_ts_ms:.1f}ms")
                return "segment_start", payload
                
            elif self.state == "speaking":
                # Update last speech timestamp
                self.last_speech_ts_ms = frame_start_ts_ms
            
            return None, None
        
        else:  # No speech detected
            self.silence_ms += frame_ms
            
            if self.state == "speaking" and self.silence_ms >= self.cfg.end_silence_ms:
                # End speech segment
                seg_start = self.first_speech_ts_ms or frame_start_ts_ms
                seg_end = (self.last_speech_ts_ms or frame_start_ts_ms) + self.cfg.post_roll_ms
                
                payload = {
                    "segment_start_ms": seg_start,
                    "segment_end_ms": seg_end
                }
                
                self.logger.info(
                    f"Speech segment ended: [{seg_start:.1f}, {seg_end:.1f}]ms "
                    f"(duration: {seg_end - seg_start:.1f}ms)"
                )
                
                # Reset state
                self._reset_state()
                
                return "segment_end", payload
            
            return None, None
    
    def _reset_state(self) -> None:
        """Reset VAD state to idle."""
        self.state = "idle"
        self.speech_ms = 0
        self.silence_ms = 0
        self.first_speech_ts_ms = None
        self.last_speech_ts_ms = None
        self.logger.debug("VAD state reset to idle")
    
    def force_segment_end(self, current_ts_ms: float) -> Optional[Dict]:
        """
        Force end current speech segment if in speaking state.
        
        Args:
            current_ts_ms: Current timestamp in milliseconds
            
        Returns:
            Segment end payload if segment was active, None otherwise
        """
        if self.state == "speaking":
            seg_start = self.first_speech_ts_ms or current_ts_ms
            seg_end = (self.last_speech_ts_ms or current_ts_ms) + self.cfg.post_roll_ms
            
            payload = {
                "segment_start_ms": seg_start,
                "segment_end_ms": seg_end
            }
            
            self.logger.info(f"Forced segment end: [{seg_start:.1f}, {seg_end:.1f}]ms")
            self._reset_state()
            
            return payload
        
        return None
    
    def get_state_info(self) -> Dict:
        """Get current VAD state information."""
        return {
            "state": self.state,
            "speech_ms": self.speech_ms,
            "silence_ms": self.silence_ms,
            "first_speech_ts_ms": self.first_speech_ts_ms,
            "last_speech_ts_ms": self.last_speech_ts_ms,
        }


def create_vad_from_env() -> RmsVadSegmenter:
    """Create VAD segmenter from environment variables."""
    import os
    
    try:
        config = VadConfig(
            frame_ms=int(os.getenv("VAD_FRAME_MS", "30")),
            min_speech_ms=int(os.getenv("VAD_MIN_SPEECH_MS", "300")),
            end_silence_ms=int(os.getenv("VAD_END_SILENCE_MS", "800")),
            pre_roll_ms=int(os.getenv("VAD_PRE_ROLL_MS", "200")),
            post_roll_ms=int(os.getenv("VAD_POST_ROLL_MS", "300")),
            amplitude_threshold=float(os.getenv("VAD_AMPLITUDE_THRESHOLD", "0.02")),
        )
        
        sample_rate = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
        
        logger.info(f"Created VAD from environment: {config}")
        return RmsVadSegmenter(sample_rate_hz=sample_rate, cfg=config)
        
    except (ValueError, TypeError) as e:
        logger.warning(f"Invalid VAD environment config, using defaults: {e}")
        return RmsVadSegmenter()
