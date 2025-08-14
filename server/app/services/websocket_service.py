"""
WebSocket service for handling real-time communication with clients.
"""
import asyncio
import base64
import json
import os
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from fastapi import WebSocket

from ..core.logging import get_logger
from ..schemas.websocket import OutgoingMessage
from ..services.gemini_service import get_gemini_service
from ..utils.media_encoder import get_media_encoder
from ..utils.vad import create_vad_from_env, RmsVadSegmenter

logger = get_logger(__name__)


class ConnectionState:
    """State management for WebSocket connections."""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.session_id: Optional[str] = None
        
        # Counters
        self.frames_received = 0
        self.audio_chunks_received = 0
        self.transcripts_received = 0
        self.text_msgs_received = 0
        
        # Data buffers
        self.frames: List[Tuple[float, bytes]] = []  # (timestamp_ms, jpeg_bytes)
        self.audio_chunks: List[Tuple[float, bytes, int, int]] = []  # (ts_ms, pcm_bytes, num_samples, sample_rate)
        self.transcripts: List[Tuple[float, str]] = []  # (timestamp_ms, text)
        
        # VAD setup
        self.sample_rate = int(os.getenv("VAD_SAMPLE_RATE", "16000"))
        self.vad = create_vad_from_env()
        self.pending_finalizations: List[Dict[str, Any]] = []
        
        # Backpressure limits
        self.max_frames_buffer = int(os.getenv("MAX_FRAMES_BUFFER", "5000"))
        self.max_audio_chunks = int(os.getenv("MAX_AUDIO_CHUNKS", "5000"))
        
        logger.info(f"Connection state initialized: max_frames={self.max_frames_buffer}, max_audio={self.max_audio_chunks}")


class WebSocketService:
    """Service for managing WebSocket connections and message processing."""
    
    def __init__(self):
        self.logger = logger
        self.gemini_service = get_gemini_service()
        self.media_encoder = get_media_encoder()
    
    async def handle_connection(self, websocket: WebSocket) -> None:
        """Handle a WebSocket connection."""
        await websocket.accept()
        state = ConnectionState(websocket)
        self.logger.info(f"WebSocket connected: {websocket.client}")
        
        # Start status task
        status_task = asyncio.create_task(self._status_task(state))
        
        try:
            async for message in websocket.iter_text():
                await self._process_message(state, message)
        except Exception as e:
            self.logger.error(f"WebSocket error: {e}")
        finally:
            status_task.cancel()
            self.logger.info(f"WebSocket disconnected: {websocket.client}")
    
    async def _status_task(self, state: ConnectionState) -> None:
        """Periodic status updates to client."""
        frames_prev = 0
        audio_prev = 0
        transcripts_prev = 0
        
        try:
            while True:
                await asyncio.sleep(5)
                
                # Send status update
                await self._send_json_safe(state.websocket, {
                    "type": "status",
                    "state": "ready",
                    "frames": state.frames_received,
                    "audio": state.audio_chunks_received,
                    "transcripts": state.transcripts_received,
                    "text": state.text_msgs_received,
                })
                
                # Log rate information
                df = state.frames_received - frames_prev
                da = state.audio_chunks_received - audio_prev
                dt = state.transcripts_received - transcripts_prev
                
                frames_prev = state.frames_received
                audio_prev = state.audio_chunks_received
                transcripts_prev = state.transcripts_received
                
                frame_rate = df / 5.0
                audio_rate = da / 5.0
                
                self.logger.debug(
                    f"Rates: {frame_rate:.1f} fps, {audio_rate:.1f} audio/s, "
                    f"{dt} transcripts, buffers: {len(state.frames)} frames, "
                    f"{len(state.audio_chunks)} audio"
                )
                
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.logger.error(f"Status task error: {e}")
    
    async def _process_message(self, state: ConnectionState, message: str) -> None:
        """Process incoming WebSocket message."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "session_start":
                await self._handle_session_start(state, data)
            elif msg_type == "frame":
                await self._handle_frame(state, data)
            elif msg_type == "audio":
                await self._handle_audio(state, data)
            elif msg_type == "transcript":
                await self._handle_transcript(state, data)
            elif msg_type == "text":
                await self._handle_text(state, data)
            else:
                self.logger.warning(f"Unknown message type: {msg_type}")
                
        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid JSON message: {e}")
        except Exception as e:
            self.logger.error(f"Message processing error: {e}")
    
    async def _handle_session_start(self, state: ConnectionState, data: Dict[str, Any]) -> None:
        """Handle session start message."""
        state.session_id = data.get("session_id")
        self.logger.info(f"Session started: {state.session_id}")
    
    async def _handle_frame(self, state: ConnectionState, data: Dict[str, Any]) -> None:
        """Handle video frame message."""
        try:
            ts_ms = data["ts_ms"]
            frame_data = base64.b64decode(data["data"])
            
            state.frames.append((ts_ms, frame_data))
            state.frames_received += 1
            
            # Apply backpressure
            if len(state.frames) > state.max_frames_buffer:
                state.frames = state.frames[-state.max_frames_buffer:]
                self.logger.warning("Frame buffer overflow, dropping old frames")
                
        except Exception as e:
            self.logger.error(f"Frame processing error: {e}")
    
    async def _handle_audio(self, state: ConnectionState, data: Dict[str, Any]) -> None:
        """Handle audio chunk message."""
        try:
            ts_ms = data["ts_ms"]
            audio_data = base64.b64decode(data["data"])
            num_samples = data["num_samples"]
            sample_rate = data["sample_rate"]
            
            state.audio_chunks.append((ts_ms, audio_data, num_samples, sample_rate))
            state.audio_chunks_received += 1
            
            # Apply backpressure
            if len(state.audio_chunks) > state.max_audio_chunks:
                state.audio_chunks = state.audio_chunks[-state.max_audio_chunks:]
                self.logger.warning("Audio buffer overflow, dropping old chunks")
            
            # Process with VAD
            event_type, payload = state.vad.process_frame(audio_data, ts_ms)
            
            if event_type == "segment_start":
                self.logger.info(f"Speech segment started: {payload}")
            elif event_type == "segment_end":
                await self._finalize_segment(state, payload["segment_start_ms"], payload["segment_end_ms"])
                
        except Exception as e:
            self.logger.error(f"Audio processing error: {e}")
    
    async def _handle_transcript(self, state: ConnectionState, data: Dict[str, Any]) -> None:
        """Handle transcript message."""
        try:
            ts_ms = data["ts_ms"]
            text = data["text"]
            is_final = data.get("is_final", False)
            
            state.transcripts.append((ts_ms, text))
            state.transcripts_received += 1
            
            self.logger.debug(f"Transcript: {text[:50]}... (final: {is_final})")
            
        except Exception as e:
            self.logger.error(f"Transcript processing error: {e}")
    
    async def _handle_text(self, state: ConnectionState, data: Dict[str, Any]) -> None:
        """Handle text message."""
        try:
            text = data["text"]
            state.text_msgs_received += 1
            
            # Generate immediate response for text-only messages
            response_text = self.gemini_service.generate_video_response(None, text)
            
            if response_text:
                await self._send_json_safe(state.websocket, {
                    "type": "response",
                    "text": response_text
                })
            
            self.logger.info(f"Text message processed: {text[:50]}...")
            
        except Exception as e:
            self.logger.error(f"Text processing error: {e}")
    
    async def _finalize_segment(
        self,
        state: ConnectionState,
        seg_start_ms: float,
        seg_end_ms: float,
        provided_text: Optional[str] = None,
        skip_transcript_wait: bool = False,
        prefer_inline_image: bool = False,
    ) -> None:
        """Finalize and process a speech segment."""
        self.logger.info(f"Finalizing segment [{seg_start_ms:.1f}, {seg_end_ms:.1f}]ms")
        
        try:
            # Wait for transcript if not provided
            if not provided_text and not skip_transcript_wait:
                provided_text = await self._await_transcript(state, seg_start_ms, seg_end_ms)
            
            text = provided_text or ""
            
            # Create temporary directory for processing
            with tempfile.TemporaryDirectory() as tmpdir:
                # Encode segment
                try:
                    result = self.media_encoder.encode_segment(
                        tmpdir, state.frames, state.audio_chunks,
                        seg_start_ms, seg_end_ms
                    )
                    
                    # Determine processing path and generate response
                    video_path = result.video_out_path if result.frame_count > 0 and os.path.exists(result.video_out_path) else None
                    
                    if video_path:
                        response_text = self.gemini_service.generate_video_response(video_path, text)
                        chosen_path = "video+text" if text else "video"
                        encoded = True
                    elif result.audio_ms > 0:
                        response_text = self.gemini_service.generate_audio_response(result.audio_wav_path, text)
                        chosen_path = "audio+text" if text else "audio"
                        encoded = False
                    else:
                        response_text = self.gemini_service.generate_video_response(None, text)
                        chosen_path = "text"
                        encoded = False
                    
                    # Send segment response
                    payload = {
                        "type": "segment",
                        "segmentStartMs": seg_start_ms,
                        "segmentEndMs": seg_end_ms,
                        "transcript": text,
                        "encoded": encoded,
                        "frameCount": result.frame_count,
                        "audioMs": result.audio_ms,
                        "fps": result.fps,
                        "responseText": response_text,
                        "chosenPath": chosen_path,
                    }
                    
                    self.logger.info(f"Segment processed: {chosen_path}, response: {len(response_text or '')} chars")
                    
                    # Send final transcript if available
                    if text:
                        await self._send_json_safe(state.websocket, {
                            "type": "transcript",
                            "text": text,
                            "isFinal": True,
                            "tsMs": seg_end_ms
                        })
                    
                    await self._send_json_safe(state.websocket, payload)
                    
                    # Send response message
                    if response_text:
                        await self._send_json_safe(state.websocket, {
                            "type": "response",
                            "text": response_text
                        })
                
                except Exception as e:
                    self.logger.error(f"Encoding failed for segment [{seg_start_ms:.1f}, {seg_end_ms:.1f}]: {e}")
                    
                    # Fallback response
                    try:
                        fallback_response = self.gemini_service.generate_video_response(None, text)
                    except Exception:
                        fallback_response = ""
                    
                    await self._send_json_safe(state.websocket, {
                        "type": "segment",
                        "segmentStartMs": seg_start_ms,
                        "segmentEndMs": seg_end_ms,
                        "transcript": text,
                        "encoded": False,
                        "error": f"encode_failed:{str(e)}",
                        "responseText": fallback_response,
                    })
                    
                    if fallback_response:
                        await self._send_json_safe(state.websocket, {
                            "type": "response",
                            "text": fallback_response
                        })
        
        except Exception as e:
            self.logger.error(f"Segment finalization failed: {e}")
    
    async def _await_transcript(
        self,
        state: ConnectionState,
        seg_start_ms: float,
        seg_end_ms: float,
        timeout_seconds: float = 2.0
    ) -> Optional[str]:
        """Wait for transcript overlapping with segment."""
        start_time = asyncio.get_event_loop().time()
        
        while (asyncio.get_event_loop().time() - start_time) < timeout_seconds:
            for ts_ms, text in state.transcripts:
                if seg_start_ms <= ts_ms <= seg_end_ms:
                    self.logger.debug(f"Found transcript for segment: {text[:50]}...")
                    return text
            
            await asyncio.sleep(0.1)
        
        self.logger.debug("No transcript found for segment within timeout")
        return None
    
    async def _send_json_safe(self, websocket: WebSocket, payload: Dict[str, Any]) -> None:
        """Safely send JSON message to WebSocket."""
        try:
            await websocket.send_text(json.dumps(payload))
        except Exception as e:
            self.logger.warning(f"Failed to send WebSocket message: {e}")


# Global service instance
_websocket_service: WebSocketService | None = None


def get_websocket_service() -> WebSocketService:
    """Get the global WebSocket service instance."""
    global _websocket_service
    if _websocket_service is None:
        _websocket_service = WebSocketService()
    return _websocket_service
