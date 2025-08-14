import asyncio
import base64
import os
from server.main import _await_transcript
from server.media_encoder import encode_segment


class DummyState:
    def __init__(self):
        self.transcripts = []


async def test_await_transcript_immediate():
    st = DummyState()
    st.transcripts.append((1000.0, "hello"))
    text = await _await_transcript(st, 900.0, 1100.0)
    assert text == "hello"


async def test_await_transcript_timeout():
    st = DummyState()
    text = await _await_transcript(st, 0.0, 100.0)
    assert text is None


def test_encode_segment_happy_path(tmp_path):
    # tiny 1x1 white JPEG
    tiny_jpeg_b64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEA8QDw8PEA8QDw8QDw8PDw8PDw8PFREWFhURFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGi0lICUtLS0tLSstLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAH4BgwMBIgACEQEDEQH/xAAcAAABBQEBAQAAAAAAAAAAAAAFAQIDBAYHAQj/xABCEAACAQIEAwUFBgUEAwEAAAABAgADEQQSITEFQVEGEyJhcYGRMqGxBzNCUrHB0RQjYqLxFUOSorPS8CMWNENTg7PD/8QAGQEAAwEBAQAAAAAAAAAAAAAAAAECAwQF/8QAKhEAAgICAgEDAwQDAAAAAAAAAAECEQMhEjEEQRMiUWEUMnGBkaHB8P/aAAwDAQACEQMRAD8A9xREQEREBERAREQEREBERAREQEREBERAREQEREBERAT//Z"
    frame_bytes = base64.b64decode(tiny_jpeg_b64)
    frames = [(0.0, frame_bytes)]
    audio = []
    res = encode_segment(str(tmp_path), frames, audio, 0.0, 10.0, encode_fps=1.0)
    assert res.frame_count >= 1
    assert res.fps > 0


