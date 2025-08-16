#!/usr/bin/env python3
"""
Minimal test for Gemini Live API based on official documentation.
This is to isolate the issue with the current implementation.
"""

import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

async def test_minimal_gemini_live():
    """Test minimal Gemini Live connection based on official docs."""
    print("🧪 Testing minimal Gemini Live connection...")
    
    # Check API key
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ Error: GEMINI_API_KEY not found!")
        return
    
    client = genai.Client(api_key=api_key)
    
    # Test 1: Basic text-only connection (from docs)
    print("\n1️⃣ Testing basic text-only connection...")
    try:
        model = "gemini-live-2.5-flash-preview"
        config = {"response_modalities": ["TEXT"]}
        
        async with client.aio.live.connect(model=model, config=config) as session:
            print("✅ Session started successfully")
            
            await session.send_realtime_input(text="Hello, can you help me with shopping?")
            
            response_count = 0
            async for response in session.receive():
                if hasattr(response, 'text') and response.text is not None:
                    print(f"📝 Response: {response.text}")
                    response_count += 1
                    if response_count >= 1:  # Just get one response
                        break
                        
        print("✅ Text-only test completed successfully")
        
    except Exception as e:
        print(f"❌ Text-only test failed: {e}")
        return False
    
    # Test 2: Native audio model with text input
    print("\n2️⃣ Testing native audio model with text input...")
    try:
        model = "gemini-2.5-flash-preview-native-audio-dialog"
        config = {"response_modalities": ["TEXT"]}  # Start with text only
        
        async with client.aio.live.connect(model=model, config=config) as session:
            print("✅ Native audio model session started")
            
            await session.send_realtime_input(text="What are the best laptop deals today?")
            
            response_count = 0
            async for response in session.receive():
                if hasattr(response, 'text') and response.text is not None:
                    print(f"📝 Response: {response.text}")
                    response_count += 1
                    if response_count >= 1:
                        break
                        
        print("✅ Native audio model text test completed successfully")
        
    except Exception as e:
        print(f"❌ Native audio model text test failed: {e}")
        return False
    
    # Test 3: Native audio model with audio output
    print("\n3️⃣ Testing native audio model with audio output...")
    try:
        model = "gemini-2.5-flash-preview-native-audio-dialog"
        config = {"response_modalities": ["TEXT", "AUDIO"]}
        
        async with client.aio.live.connect(model=model, config=config) as session:
            print("✅ Native audio model with audio output session started")
            
            await session.send_realtime_input(text="Tell me about the best smartphone deals")
            
            text_responses = []
            audio_data = b""
            response_count = 0
            
            async for response in session.receive():
                if hasattr(response, 'text') and response.text is not None:
                    text_responses.append(response.text)
                    print(f"📝 Text: {response.text}")
                
                if hasattr(response, 'data') and response.data is not None:
                    audio_data += response.data
                    print(f"🔊 Audio chunk: {len(response.data)} bytes")
                
                response_count += 1
                if response_count >= 10:  # Limit responses
                    break
            
            print(f"✅ Received {len(text_responses)} text responses and {len(audio_data)} bytes of audio")
            
            # Save audio if we got any
            if audio_data:
                import wave
                with wave.open("test_minimal_response.wav", "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(24000)
                    wf.writeframes(audio_data)
                print("🎵 Audio saved to test_minimal_response.wav")
                        
        print("✅ Audio output test completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Audio output test failed: {e}")
        return False

async def main():
    """Run all tests."""
    print("🚀 Starting Minimal Gemini Live Tests")
    print("=" * 50)
    
    success = await test_minimal_gemini_live()
    
    print("\n" + "=" * 50)
    if success:
        print("✅ All tests passed! Gemini Live is working correctly.")
    else:
        print("❌ Tests failed. Check your API key and network connection.")

if __name__ == "__main__":
    asyncio.run(main())
