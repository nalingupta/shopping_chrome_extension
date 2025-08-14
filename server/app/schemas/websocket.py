"""
WebSocket message schemas for the shopping extension.
"""
from typing import Any, Dict, List, Optional, Union, Literal
from pydantic import BaseModel, Field


class WebSocketMessage(BaseModel):
    """Base WebSocket message."""
    type: str = Field(..., description="Message type")


class SessionStartMessage(WebSocketMessage):
    """Session start message from client."""
    type: Literal["session_start"] = "session_start"
    session_id: str = Field(..., description="Unique session identifier")


class FrameMessage(WebSocketMessage):
    """Video frame message from client."""
    type: Literal["frame"] = "frame"
    ts_ms: float = Field(..., description="Timestamp in milliseconds")
    data: str = Field(..., description="Base64 encoded JPEG frame data")


class AudioMessage(WebSocketMessage):
    """Audio chunk message from client."""
    type: Literal["audio"] = "audio"
    ts_ms: float = Field(..., description="Timestamp in milliseconds")
    data: str = Field(..., description="Base64 encoded PCM audio data")
    num_samples: int = Field(..., description="Number of audio samples")
    sample_rate: int = Field(..., description="Audio sample rate in Hz")


class TranscriptMessage(WebSocketMessage):
    """Transcript message from client."""
    type: Literal["transcript"] = "transcript"
    ts_ms: float = Field(..., description="Timestamp in milliseconds")
    text: str = Field(..., description="Transcript text")
    is_final: bool = Field(default=False, description="Whether transcript is final")


class TextMessage(WebSocketMessage):
    """Text message from client."""
    type: Literal["text"] = "text"
    text: str = Field(..., description="Text content")


class StatusResponse(WebSocketMessage):
    """Status response to client."""
    type: Literal["status"] = "status"
    state: str = Field(..., description="Connection state")
    frames: int = Field(..., description="Total frames received")
    audio: int = Field(..., description="Total audio chunks received")
    transcripts: int = Field(..., description="Total transcripts received")
    text: int = Field(..., description="Total text messages received")


class TranscriptResponse(WebSocketMessage):
    """Transcript response to client."""
    type: Literal["transcript"] = "transcript"
    text: str = Field(..., description="Transcript text")
    is_final: bool = Field(..., description="Whether transcript is final")
    ts_ms: float = Field(..., description="Timestamp in milliseconds")


class SegmentResponse(WebSocketMessage):
    """Segment processing response to client."""
    type: Literal["segment"] = "segment"
    segment_start_ms: float = Field(..., description="Segment start time in ms")
    segment_end_ms: float = Field(..., description="Segment end time in ms")
    transcript: Optional[str] = Field(None, description="Segment transcript")
    encoded: bool = Field(..., description="Whether segment was successfully encoded")
    frame_count: int = Field(..., description="Number of frames in segment")
    audio_ms: float = Field(..., description="Audio duration in milliseconds")
    fps: float = Field(..., description="Frames per second")
    response_text: Optional[str] = Field(None, description="AI response text")
    chosen_path: str = Field(..., description="Processing path used (video/audio/text)")
    error: Optional[str] = Field(None, description="Error message if processing failed")


class ResponseMessage(WebSocketMessage):
    """AI response message to client."""
    type: Literal["response"] = "response"
    text: str = Field(..., description="AI response text")


class ErrorResponse(WebSocketMessage):
    """Error response to client."""
    type: Literal["error"] = "error"
    message: str = Field(..., description="Error message")
    code: Optional[str] = Field(None, description="Error code")


# Union type for all possible incoming messages
IncomingMessage = Union[
    SessionStartMessage,
    FrameMessage,
    AudioMessage,
    TranscriptMessage,
    TextMessage
]

# Union type for all possible outgoing messages
OutgoingMessage = Union[
    StatusResponse,
    TranscriptResponse,
    SegmentResponse,
    ResponseMessage,
    ErrorResponse
]
