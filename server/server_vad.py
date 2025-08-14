from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ServerVadConfig:
    frame_ms: int = 30
    min_speech_ms: int = 300
    end_silence_ms: int = 800
    pre_roll_ms: int = 200
    post_roll_ms: int = 300
    amplitude_threshold: float = 0.02  # normalized (0..1) RMS threshold


class ServerRmsVadSegmenter:
    def __init__(self, sample_rate_hz: int = 16000, cfg: ServerVadConfig | None = None) -> None:
        self.cfg = cfg or ServerVadConfig()
        self.sample_rate_hz = sample_rate_hz
        self.state = "idle"  # idle | speaking
        self.speech_ms = 0
        self.silence_ms = 0
        self.first_speech_ts_ms: float | None = None
        self.last_speech_ts_ms: float | None = None

    def _frame_is_speech(self, pcm_le_int16: bytes) -> bool:
        # Compute RMS amplitude quickly
        if not pcm_le_int16:
            return False
        # Each sample is 2 bytes little-endian signed
        total = 0
        count = 0
        # iterate 2 bytes at a time
        for i in range(0, len(pcm_le_int16), 2):
            if i + 1 >= len(pcm_le_int16):
                break
            s = int.from_bytes(pcm_le_int16[i : i + 2], "little", signed=True)
            total += abs(s)
            count += 1
        if count == 0:
            return False
        rms = (total / count) / 32768.0
        return rms >= self.cfg.amplitude_threshold

    def process_frame(self, frame_bytes: bytes, frame_start_ts_ms: float) -> tuple[str | None, dict | None]:
        """
        Returns (event_type, payload)
        event_type: None | "segment_start" | "segment_end"
        payload:
          segment_start -> {"segment_start_ms": float}
          segment_end   -> {"segment_start_ms": float, "segment_end_ms": float}
        """
        is_speech = self._frame_is_speech(frame_bytes)
        frame_ms = self.cfg.frame_ms

        if is_speech:
            self.speech_ms += frame_ms
            self.silence_ms = 0
            if self.state == "idle" and self.speech_ms >= self.cfg.min_speech_ms:
                self.state = "speaking"
                # First speech ts is the current frame start minus accumulated speech minus pre-roll
                self.first_speech_ts_ms = frame_start_ts_ms - (self.speech_ms - frame_ms) - self.cfg.pre_roll_ms
                if self.first_speech_ts_ms < 0:
                    self.first_speech_ts_ms = 0
                self.last_speech_ts_ms = frame_start_ts_ms
                return "segment_start", {"segment_start_ms": self.first_speech_ts_ms}
            elif self.state == "speaking":
                self.last_speech_ts_ms = frame_start_ts_ms
            return None, None
        else:
            self.silence_ms += frame_ms
            if self.state == "speaking" and self.silence_ms >= self.cfg.end_silence_ms:
                # close segment
                seg_start = self.first_speech_ts_ms if self.first_speech_ts_ms is not None else frame_start_ts_ms
                seg_end = (self.last_speech_ts_ms or frame_start_ts_ms) + self.cfg.post_roll_ms
                # reset state
                self.state = "idle"
                self.speech_ms = 0
                self.silence_ms = 0
                self.first_speech_ts_ms = None
                self.last_speech_ts_ms = None
                return "segment_end", {"segment_start_ms": seg_start, "segment_end_ms": seg_end}
            return None, None


