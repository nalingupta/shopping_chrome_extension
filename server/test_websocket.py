#!/usr/bin/env python3
"""
WebSocket test client for the shopping extension server.
Tests all message types and connection handling.
"""
import asyncio
import base64
import json
import time
import uuid
from typing import Dict, Any
import websockets
import argparse


class WebSocketTester:
    """WebSocket test client."""
    
    def __init__(self, url: str):
        self.url = url
        self.websocket = None
        self.session_id = str(uuid.uuid4())
        
    async def connect(self):
        """Connect to WebSocket server."""
        try:
            print(f"🔌 Connecting to {self.url}")
            self.websocket = await websockets.connect(self.url)
            print("✅ Connected successfully!")
            return True
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from WebSocket server."""
        if self.websocket:
            await self.websocket.close()
            print("🔌 Disconnected")
    
    async def send_message(self, message: Dict[str, Any]):
        """Send a message to the server."""
        if not self.websocket:
            print("❌ Not connected")
            return
            
        try:
            json_msg = json.dumps(message)
            await self.websocket.send(json_msg)
            print(f"📤 Sent: {message['type']}")
        except Exception as e:
            print(f"❌ Send error: {e}")
    
    async def receive_messages(self, duration: float = 10.0):
        """Listen for messages from server."""
        if not self.websocket:
            print("❌ Not connected")
            return
            
        print(f"👂 Listening for messages ({duration}s)...")
        end_time = time.time() + duration
        
        try:
            while time.time() < end_time:
                try:
                    # Wait for message with timeout
                    message = await asyncio.wait_for(
                        self.websocket.recv(), 
                        timeout=1.0
                    )
                    
                    data = json.loads(message)
                    msg_type = data.get('type', 'unknown')
                    print(f"📥 Received [{msg_type}]: {json.dumps(data, indent=2)}")
                    
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    print("🔌 Connection closed by server")
                    break
                    
        except Exception as e:
            print(f"❌ Receive error: {e}")
    
    async def test_session_start(self):
        """Test session start message."""
        print("\n🧪 Testing session start...")
        message = {
            "type": "session_start",
            "session_id": self.session_id
        }
        await self.send_message(message)
    
    async def test_text_message(self):
        """Test text message."""
        print("\n🧪 Testing text message...")
        message = {
            "type": "text",
            "text": "Hello, this is a test message for the shopping assistant!"
        }
        await self.send_message(message)
    
    async def test_transcript_message(self):
        """Test transcript message."""
        print("\n🧪 Testing transcript message...")
        message = {
            "type": "transcript",
            "ts_ms": time.time() * 1000,
            "text": "I want to buy a new laptop",
            "is_final": True
        }
        await self.send_message(message)
    
    async def test_frame_message(self):
        """Test frame message with dummy image data."""
        print("\n🧪 Testing frame message...")
        
        # Create a small dummy JPEG (1x1 pixel)
        dummy_jpeg = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x11\x08\x00\x01\x00\x01\x01\x01\x11\x00\x02\x11\x01\x03\x11\x01\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x08\xff\xc4\x00\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xda\x00\x0c\x03\x01\x00\x02\x11\x03\x11\x00\x3f\x00\xaa\xff\xd9'
        
        message = {
            "type": "frame",
            "ts_ms": time.time() * 1000,
            "data": base64.b64encode(dummy_jpeg).decode('utf-8')
        }
        await self.send_message(message)
    
    async def test_audio_message(self):
        """Test audio message with proper VAD-triggering sequence."""
        print("\n🧪 Testing audio sequence (VAD simulation)...")
        await self.send_audio_sequence()
    
    async def send_audio_sequence(self):
        """Send audio sequence that triggers VAD processing."""
        import struct
        import math
        
        sample_rate = 16000
        frame_samples = 480  # 30ms at 16kHz
        start_time = time.time() * 1000
        
        print("📢 Phase 1: Sending speech frames (500ms)...")
        # Phase 1: Send 500ms of "speech" (above VAD threshold)
        for frame in range(17):  # 17 frames = ~510ms
            # Generate louder sine wave (above VAD threshold)
            pcm_data = bytearray()
            for i in range(frame_samples):
                sample_value = math.sin(2 * math.pi * 440 * (frame * frame_samples + i) / sample_rate)
                # Scale to 16-bit integer with higher amplitude
                sample_int = int(sample_value * 16000)
                pcm_data.extend(struct.pack('<h', sample_int))
            
            message = {
                "type": "audio",
                "ts_ms": start_time + (frame * 30),
                "data": base64.b64encode(pcm_data).decode('utf-8'),
                "num_samples": frame_samples,
                "sample_rate": sample_rate
            }
            await self.send_message(message)
            await asyncio.sleep(0.01)  # Small delay between frames
        
        print("🤫 Phase 2: Sending silence frames (1000ms)...")
        # Phase 2: Send 1000ms of silence (below threshold)
        for frame in range(34):  # 34 frames = ~1020ms
            # Generate very quiet noise
            pcm_data = bytearray()
            for i in range(frame_samples):
                # Very low amplitude noise
                sample_int = int((hash(frame * frame_samples + i) % 100) - 50)
                pcm_data.extend(struct.pack('<h', sample_int))
            
            message = {
                "type": "audio",
                "ts_ms": start_time + 510 + (frame * 30),  # After speech phase
                "data": base64.b64encode(pcm_data).decode('utf-8'),
                "num_samples": frame_samples,
                "sample_rate": sample_rate
            }
            await self.send_message(message)
            await asyncio.sleep(0.01)
        
        print("✅ Audio sequence complete! VAD should trigger segment processing...")
    
    async def run_comprehensive_test(self):
        """Run all tests in sequence."""
        if not await self.connect():
            return
        
        try:
            # Start session
            await self.test_session_start()
            await asyncio.sleep(1)
            
            # Test different message types
            await self.test_text_message()
            await asyncio.sleep(2)
            
            await self.test_transcript_message()
            await asyncio.sleep(2)
            
            await self.test_frame_message()
            await asyncio.sleep(1)
            
            await self.test_audio_message()
            await asyncio.sleep(2)
            
            # Listen for responses
            await self.receive_messages(duration=5.0)
            
        finally:
            await self.disconnect()
    
    async def run_interactive_test(self):
        """Run interactive test session."""
        if not await self.connect():
            return
        
        try:
            await self.test_session_start()
            await asyncio.sleep(1)
            
            print("\n🎮 Interactive mode - type messages (or 'quit' to exit):")
            
            # Start listening task
            listen_task = asyncio.create_task(
                self.receive_messages(duration=300)  # 5 minutes
            )
            
            while True:
                try:
                    user_input = input("\n💬 Enter message: ").strip()
                    if user_input.lower() in ['quit', 'exit', 'q']:
                        break
                    
                    if user_input:
                        message = {
                            "type": "text",
                            "text": user_input
                        }
                        await self.send_message(message)
                        
                except KeyboardInterrupt:
                    break
            
            listen_task.cancel()
            
        finally:
            await self.disconnect()


async def main():
    """Main function."""
    parser = argparse.ArgumentParser(description="WebSocket test client")
    parser.add_argument(
        "--url", 
        default="ws://localhost:8767/api/v1/ws",
        help="WebSocket URL to connect to"
    )
    parser.add_argument(
        "--mode",
        choices=["test", "interactive"],
        default="test",
        help="Test mode: 'test' for automated tests, 'interactive' for manual testing"
    )
    
    args = parser.parse_args()
    
    print("🚀 WebSocket Test Client")
    print(f"📍 Target: {args.url}")
    print(f"🎯 Mode: {args.mode}")
    
    tester = WebSocketTester(args.url)
    
    if args.mode == "interactive":
        await tester.run_interactive_test()
    else:
        await tester.run_comprehensive_test()


if __name__ == "__main__":
    asyncio.run(main())
