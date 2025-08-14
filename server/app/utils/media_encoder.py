"""
Media encoding utilities for processing video frames and audio segments.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from typing import List, Tuple

from ..core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class EncodeResult:
    """Result of media encoding operation."""
    video_out_path: str
    frame_count: int
    audio_ms: float
    fps: float
    audio_wav_path: str


class MediaEncoder:
    """Service for encoding video frames and audio segments."""
    
    def __init__(self):
        self.logger = logger
    
    def encode_segment(
        self,
        session_dir: str,
        frames: List[Tuple[float, bytes]],
        audio_chunks: List[Tuple[float, bytes, int, int]],
        seg_start_ms: float,
        seg_end_ms: float,
        encode_fps: float = 2.0,
    ) -> EncodeResult:
        """
        Encode a segment of frames and audio into a video file.
        
        Args:
            session_dir: Directory to store temporary and output files
            frames: List of (timestamp_ms, jpeg_bytes) tuples
            audio_chunks: List of (timestamp_ms, pcm_bytes, num_samples, sample_rate) tuples
            seg_start_ms: Segment start time in milliseconds
            seg_end_ms: Segment end time in milliseconds
            encode_fps: Target frames per second for encoding
            
        Returns:
            EncodeResult with paths and metadata
        """
        self.logger.info(f"Encoding segment [{seg_start_ms:.1f}, {seg_end_ms:.1f}] ms")
        
        try:
            self._ensure_dir(session_dir)
            
            # 1) Extract and encode audio
            pcm_bytes, sample_rate = self._extract_audio_segment_bytes(
                audio_chunks, seg_start_ms, seg_end_ms
            )
            audio_wav_path = os.path.join(session_dir, "audio.wav")
            audio_ms = self._write_wav_mono_16k(pcm_bytes, sample_rate, audio_wav_path)
            
            # 2) Select and prepare frames
            frames_dir = os.path.join(session_dir, "frames")
            self._ensure_dir(frames_dir)
            selected_frames, frame_count = self._select_frames_for_segment(
                frames, seg_start_ms, seg_end_ms, encode_fps, frames_dir
            )
            
            # 3) Adjust frame durations to match audio length
            self._adjust_frame_durations(selected_frames, audio_ms)
            
            # 4) Create concat file and mux to video
            concat_path = os.path.join(session_dir, "frames.txt")
            self._write_concat_file(selected_frames, concat_path)
            
            out_path = os.path.join(session_dir, "out.webm")
            if frame_count > 0:
                self._mux_to_webm(concat_path, audio_wav_path, out_path)
            
            self.logger.info(
                f"Encoded segment: {frame_count} frames, {audio_ms:.1f}ms audio, "
                f"{encode_fps} fps"
            )
            
            return EncodeResult(
                video_out_path=out_path,
                frame_count=frame_count,
                audio_ms=audio_ms,
                fps=encode_fps,
                audio_wav_path=audio_wav_path
            )
            
        except Exception as e:
            self.logger.error(f"Failed to encode segment: {e}")
            raise
    
    def _ensure_dir(self, path: str) -> None:
        """Ensure directory exists."""
        os.makedirs(path, exist_ok=True)
    
    def _extract_audio_segment_bytes(
        self,
        chunks: List[Tuple[float, bytes, int, int]],
        segment_start_ms: float,
        segment_end_ms: float,
    ) -> Tuple[bytes, int]:
        """
        Extract audio bytes for a specific time segment.
        
        Args:
            chunks: List of (timestamp_ms, pcm_bytes, num_samples, sample_rate) tuples
            segment_start_ms: Start time in milliseconds
            segment_end_ms: End time in milliseconds
            
        Returns:
            Tuple of (pcm_bytes, sample_rate)
        """
        if not chunks:
            return b"", 16000
        
        # Use sample rate from first chunk; assume consistent
        sample_rate = chunks[0][3] if len(chunks[0]) >= 4 else 16000
        output_bytes = bytearray()
        
        for ts_start, pcm_bytes, num_samples, chunk_sample_rate in chunks:
            if chunk_sample_rate != sample_rate:
                self.logger.warning(f"Inconsistent sample rate: {chunk_sample_rate} vs {sample_rate}")
                continue
            
            duration_ms = (num_samples / sample_rate) * 1000.0
            ts_end = ts_start + duration_ms
            
            # Check for overlap with segment
            if ts_end <= segment_start_ms or ts_start >= segment_end_ms:
                continue
            
            # Calculate sample offsets within this chunk
            start_offset_ms = max(0.0, segment_start_ms - ts_start)
            end_offset_ms = max(0.0, ts_end - min(ts_end, segment_end_ms))
            
            start_sample = int((start_offset_ms / 1000.0) * sample_rate)
            end_sample_exclusive = int(num_samples - (end_offset_ms / 1000.0) * sample_rate)
            
            start_byte = start_sample * 2  # 16-bit samples = 2 bytes each
            end_byte = end_sample_exclusive * 2
            
            if start_byte < end_byte <= len(pcm_bytes):
                output_bytes.extend(pcm_bytes[start_byte:end_byte])
        
        return bytes(output_bytes), sample_rate
    
    def _write_wav_mono_16k(self, pcm_le_int16: bytes, sample_rate: int, dst_path: str) -> float:
        """
        Write PCM data to WAV file.
        
        Returns:
            Duration in milliseconds
        """
        with wave.open(dst_path, "wb") as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_le_int16)
        
        # Calculate duration
        frames = len(pcm_le_int16) // 2
        duration_ms = (frames / sample_rate) * 1000.0
        self.logger.debug(f"Wrote WAV file: {frames} samples, {duration_ms:.1f}ms")
        return duration_ms
    
    def _select_frames_for_segment(
        self,
        frames: List[Tuple[float, bytes]],
        segment_start_ms: float,
        segment_end_ms: float,
        encode_fps: float,
        temp_dir: str,
    ) -> Tuple[List[Tuple[str, float]], int]:
        """
        Select and save frames for the segment at target FPS.
        
        Returns:
            Tuple of ([(frame_path, duration_sec)], total_selected)
        """
        if not frames or segment_end_ms <= segment_start_ms:
            return [], 0
        
        frames_sorted = sorted(frames, key=lambda x: x[0])
        step_ms = 1000.0 / encode_fps
        selected: List[Tuple[str, float]] = []
        
        t = segment_start_ms
        idx = 0
        last_path: str | None = None
        
        while t <= segment_end_ms + 1e-6:
            # Find nearest frame at or after time t
            nearest_bytes = None
            
            for j in range(idx, len(frames_sorted)):
                ts, data = frames_sorted[j]
                if ts >= t:
                    nearest_bytes = data
                    idx = j
                    break
            
            if nearest_bytes is None:
                # Use last available frame or duplicate last_path
                if last_path is None:
                    break
                selected.append((last_path, step_ms / 1000.0))
            else:
                # Write frame to file
                frame_filename = f"frame_{len(selected):06d}.jpg"
                frame_path = os.path.join(temp_dir, frame_filename)
                
                with open(frame_path, "wb") as f:
                    f.write(nearest_bytes)
                
                last_path = frame_path
                selected.append((frame_path, step_ms / 1000.0))
            
            t += step_ms
        
        self.logger.debug(f"Selected {len(selected)} frames for segment")
        return selected, len(selected)
    
    def _adjust_frame_durations(self, selected_frames: List[Tuple[str, float]], audio_ms: float) -> None:
        """Adjust last frame duration to match audio length."""
        if not selected_frames or audio_ms <= 0:
            return
        
        total_duration = sum(duration for _, duration in selected_frames)
        desired_duration = audio_ms / 1000.0
        difference = desired_duration - total_duration
        
        if abs(difference) > 0.001:
            path, duration = selected_frames[-1]
            new_duration = max(0.01, duration + difference)
            selected_frames[-1] = (path, new_duration)
            self.logger.debug(f"Adjusted last frame duration by {difference:.3f}s")
    
    def _write_concat_file(self, frames_with_durations: List[Tuple[str, float]], concat_path: str) -> None:
        """Write FFmpeg concat file."""
        with open(concat_path, "w") as f:
            if not frames_with_durations:
                return
            
            f.write("ffconcat version 1.0\n")
            
            for i, (path, duration) in enumerate(frames_with_durations):
                if i < len(frames_with_durations) - 1:
                    f.write(f"file '{path}'\n")
                    f.write(f"duration {duration:.6f}\n")
                else:
                    # Last file: write twice without duration
                    f.write(f"file '{path}'\n")
                    f.write(f"file '{path}'\n")
    
    def _mux_to_webm(self, concat_path: str, audio_wav_path: str, out_path: str) -> None:
        """Mux frames and audio into WebM video."""
        cmd = [
            "ffmpeg", "-y", "-safe", "0",
            "-f", "concat", "-i", concat_path,
            "-i", audio_wav_path,
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuv420p",
            "-c:a", "libopus",
            "-shortest",
            out_path,
        ]
        
        self.logger.debug(f"Running FFmpeg: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                check=True
            )
            self.logger.info(f"Successfully created video: {out_path}")
            
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.decode("utf-8", errors="ignore")[:1200]
            self.logger.error(f"FFmpeg failed (code {e.returncode}): {error_msg}")
            raise RuntimeError(f"FFmpeg encoding failed: {error_msg}")


# Global encoder instance
_media_encoder: MediaEncoder | None = None


def get_media_encoder() -> MediaEncoder:
    """Get the global media encoder instance."""
    global _media_encoder
    if _media_encoder is None:
        _media_encoder = MediaEncoder()
    return _media_encoder
