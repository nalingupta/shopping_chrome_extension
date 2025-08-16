#!/usr/bin/env python3
"""
Test script for the new Gemini Live audio capabilities.
This demonstrates how to use the enhanced Gemini client with native audio dialog.
"""

import asyncio
import os
from pathlib import Path
from gemini_client_enhanced import generate_live_audio_response, AudioTextResponse


async def test_text_to_audio():
    """Test text input with both text and audio response."""
    print("🎯 Testing text input with audio response...")
    
    response = await generate_live_audio_response(
        transcript_text="What are the best Black Friday deals on electronics?",
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="test_response.wav"
    )
    
    print(f"✅ Text response: {response.text}")
    print(f"📊 Audio data size: {len(response.audio_data)} bytes")
    print(f"🎵 Audio format: {response.audio_format} at {response.sample_rate}Hz")
    
    if response.audio_data:
        print("🔊 Audio response saved to 'test_response.wav'")
    
    return response


async def test_audio_only_response():
    """Test getting only audio response without text."""
    print("\n🎯 Testing audio-only response...")
    
    response = await generate_live_audio_response(
        transcript_text="Tell me about the latest smartphone deals",
        response_modalities=["AUDIO"],
        output_audio_path="audio_only_response.wav"
    )
    
    print(f"✅ Text response: '{response.text}' (should be empty)")
    print(f"📊 Audio data size: {len(response.audio_data)} bytes")
    
    return response


async def test_text_only_response():
    """Test getting only text response without audio."""
    print("\n🎯 Testing text-only response...")
    
    response = await generate_live_audio_response(
        transcript_text="What's the best laptop under $1000?",
        response_modalities=["TEXT"]
    )
    
    print(f"✅ Text response: {response.text}")
    print(f"📊 Audio data size: {len(response.audio_data)} bytes (should be 0)")
    
    return response


async def test_with_custom_prompt():
    """Test with custom system prompt."""
    print("\n🎯 Testing with custom system prompt...")
    
    custom_prompt = (
        "You are an expert shopping assistant specializing in tech products. "
        "Provide detailed, enthusiastic recommendations with specific product names and prices when possible."
    )
    
    response = await generate_live_audio_response(
        transcript_text="I need a gaming laptop recommendation",
        system_prompt=custom_prompt,
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="custom_prompt_response.wav"
    )
    
    print(f"✅ Text response: {response.text}")
    print(f"📊 Audio data size: {len(response.audio_data)} bytes")
    
    return response


async def main():
    """Run all tests."""
    print("🚀 Starting Gemini Live Audio Tests")
    print("=" * 50)
    
    # Check if API key is set
    if not os.getenv("GEMINI_API_KEY"):
        print("❌ Error: GEMINI_API_KEY environment variable not set!")
        print("Please set your API key in the .env file or environment variables.")
        return
    
    try:
        # Run tests
        await test_text_to_audio()
        await test_audio_only_response()
        await test_text_only_response()
        await test_with_custom_prompt()
        
        print("\n" + "=" * 50)
        print("✅ All tests completed successfully!")
        print("\nGenerated files:")
        
        # List generated audio files
        audio_files = [
            "test_response.wav",
            "audio_only_response.wav", 
            "custom_prompt_response.wav"
        ]
        
        for file in audio_files:
            if Path(file).exists():
                size = Path(file).stat().st_size
                print(f"  📁 {file} ({size} bytes)")
        
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        print("This might be due to:")
        print("  - Missing API key")
        print("  - Network connectivity issues")
        print("  - Missing dependencies (run: pip install -r requirements.txt)")


if __name__ == "__main__":
    asyncio.run(main())
