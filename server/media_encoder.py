from __future__ import annotations

import os
import tempfile
import subprocess
from dataclasses import dataclass
from typing import List, Tuple
import wave


@dataclass
class EncodeResult:
    video_out_path: str
    frame_count: int
    audio_ms: float
    fps: float
    audio_wav_path: str


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def extract_audio_segment_bytes(
    chunks: List[Tuple[float, bytes, int, int]],
    segment_start_ms: float,
    segment_end_ms: float,
) -> Tuple[bytes, int]:
    """
    chunks: list of (tsStartMs, pcm_bytes, num_samples, sample_rate)
    Returns (pcm_bytes, sample_rate)
    """
    if not chunks:
        return b"", 16000
    # Use sample rate from first chunk; assume consistent
    sr = chunks[0][3] if len(chunks[0]) >= 4 else 16000
    out = bytearray()
    for ts_start, pcm_bytes, num_samples, sr_chunk in chunks:
        if sr_chunk != sr:
            # simple guard: skip different SR chunks (shouldn't happen)
            continue
        dur_ms = (num_samples / sr) * 1000.0
        ts_end = ts_start + dur_ms
        # overlap with [segment_start_ms, segment_end_ms]
        if ts_end <= segment_start_ms or ts_start >= segment_end_ms:
            continue
        # compute sample offsets within this chunk
        start_offset_ms = max(0.0, segment_start_ms - ts_start)
        end_offset_ms = max(0.0, ts_end - min(ts_end, segment_end_ms))
        start_sample = int((start_offset_ms / 1000.0) * sr)
        end_sample_exclusive = int(num_samples - (end_offset_ms / 1000.0) * sr)
        start_byte = start_sample * 2
        end_byte = end_sample_exclusive * 2
        if start_byte < end_byte <= len(pcm_bytes):
            out.extend(pcm_bytes[start_byte:end_byte])
    return bytes(out), sr


def write_wav_mono_16k(pcm_le_int16: bytes, sample_rate: int, dst_path: str) -> float:
    with wave.open(dst_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_le_int16)
    # duration ms
    frames = len(pcm_le_int16) // 2
    return (frames / sample_rate) * 1000.0


def select_frames_for_segment(
    frames: List[Tuple[float, bytes]],
    segment_start_ms: float,
    segment_end_ms: float,
    encode_fps: float,
    temp_dir: str,
) -> Tuple[List[Tuple[str, float]], int]:
    """Returns ([(frame_path, duration_sec)], total_selected)."""
    if not frames or segment_end_ms <= segment_start_ms:
        return [], 0
    # sort by ts
    frames_sorted = sorted(frames, key=lambda x: x[0])
    step_ms = 1000.0 / encode_fps
    t = segment_start_ms
    selected: List[Tuple[str, float]] = []
    idx = 0
    last_path: str | None = None
    while t <= segment_end_ms + 1e-6:
        # advance idx to the first frame with ts >= t (or use previous as fallback)
        nearest_ts = None
        nearest_bytes = None
        # simple linear scan from current idx; frames are ~sparse, encode_fps low
        for j in range(idx, len(frames_sorted)):
            ts, data = frames_sorted[j]
            if ts >= t:
                nearest_ts = ts
                nearest_bytes = data
                idx = j
                break
        if nearest_bytes is None:
            # use last available frame or last_path duplicate
            if last_path is None:
                break
            # duplicate last frame by duration step
            selected.append((last_path, step_ms / 1000.0))
        else:
            # write frame to file
            fname = f"frame_{len(selected):06d}.jpg"
            fpath = os.path.join(temp_dir, fname)
            with open(fpath, "wb") as f:
                f.write(nearest_bytes)
            last_path = fpath
            selected.append((fpath, step_ms / 1000.0))
        t += step_ms
    return selected, len(selected)


def write_concat_file(frames_with_durations: List[Tuple[str, float]], concat_path: str) -> None:
    with open(concat_path, "w") as f:
        if not frames_with_durations:
            return
        for i, (path, dur) in enumerate(frames_with_durations):
            # ffmpeg concat demuxer expects duration BEFORE file, and last file listed twice (or without duration)
            if i < len(frames_with_durations) - 1:
                f.write(f"duration {dur:.6f}\n")
                f.write(f"file '{path}'\n")
            else:
                # last file: write duration then file twice to honor duration
                f.write(f"duration {dur:.6f}\n")
                f.write(f"file '{path}'\n")
                f.write(f"file '{path}'\n")


def mux_to_webm(concat_path: str, audio_wav_path: str, out_path: str) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-safe",
        "0",
        "-f",
        "concat",
        "-i",
        concat_path,
        "-i",
        audio_wav_path,
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "libopus",
        "-shortest",
        out_path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {err[:1200]}")


def encode_segment(
    session_dir: str,
    frames: List[Tuple[float, bytes]],
    audio_chunks: List[Tuple[float, bytes, int, int]],
    seg_start_ms: float,
    seg_end_ms: float,
    encode_fps: float = 2.0,
) -> EncodeResult:
    _ensure_dir(session_dir)
    # 1) audio
    pcm_bytes, sr = extract_audio_segment_bytes(audio_chunks, seg_start_ms, seg_end_ms)
    audio_wav_path = os.path.join(session_dir, "audio.wav")
    audio_ms = write_wav_mono_16k(pcm_bytes, sr, audio_wav_path)
    # 2) frames (downsampled)
    frames_dir = os.path.join(session_dir, "frames")
    _ensure_dir(frames_dir)
    selected, count = select_frames_for_segment(frames, seg_start_ms, seg_end_ms, encode_fps, frames_dir)
    # Adjust last frame duration to match audio length if necessary
    total_dur = sum(d for _, d in selected)
    if selected and audio_ms > 0:
        desired_sec = audio_ms / 1000.0
        diff = desired_sec - total_dur
        if abs(diff) > 0.001:
            path, dur = selected[-1]
            selected[-1] = (path, max(0.01, dur + diff))
    concat_path = os.path.join(session_dir, "frames.txt")
    write_concat_file(selected, concat_path)
    out_path = os.path.join(session_dir, "out.webm")
    if count > 0:
        mux_to_webm(concat_path, audio_wav_path, out_path)
    return EncodeResult(video_out_path=out_path, frame_count=count, audio_ms=audio_ms, fps=encode_fps, audio_wav_path=audio_wav_path)


