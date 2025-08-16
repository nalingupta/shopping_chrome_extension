# Gemini Live Integration Guide

This guide explains how to integrate the new **Gemini 2.5 Flash Preview Native Audio Dialog** model into your shopping Chrome extension.

## Overview

The enhanced Gemini client now supports:
- **Text + Audio Input**: Send both text transcripts and audio files
- **Text + Audio Output**: Receive both text responses and audio responses
- **Real-time Processing**: Stream audio responses as they're generated
- **Fallback Support**: Graceful fallback to text-only responses

## Key Features

### 1. Native Audio Dialog Model
- Model: `gemini-2.5-flash-preview-native-audio-dialog`
- Supports real-time audio conversation
- 24kHz audio output quality
- Configurable response modalities

### 2. AudioTextResponse Class
```python
@dataclass
class AudioTextResponse:
    text: str = ""           # Text response from the model
    audio_data: bytes = b""  # Raw audio bytes (WAV format)
    audio_format: str = "wav"
    sample_rate: int = 24000
```

## Usage Examples

### Basic Text-to-Audio Response
```python
import asyncio
from gemini_client_enhanced import generate_live_audio_response

async def get_shopping_advice():
    response = await generate_live_audio_response(
        transcript_text="What are the best laptop deals today?",
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="response.wav"
    )
    
    print(f"Text: {response.text}")
    print(f"Audio saved: {len(response.audio_data)} bytes")
```

### Audio File Input
```python
async def process_audio_question():
    response = await generate_live_audio_response(
        audio_file_path="user_question.wav",
        response_modalities=["TEXT", "AUDIO"]
    )
    
    # Save audio response
    if response.audio_data:
        with open("assistant_response.wav", "wb") as f:
            f.write(response.audio_data)
```

### Combined Video + Audio Analysis
```python
async def multimodal_shopping_assistant():
    response = await generate_live_multimodal_response(
        video_path="shopping_session.webm",
        transcript_text="Help me find similar products",
        response_modalities=["TEXT", "AUDIO"],
        output_audio_path="multimodal_response.wav"
    )
    
    return response
```

## Integration with Your Extension

### 1. Update Dependencies
Install the required packages:
```bash
pip install -r requirements.txt
```

### 2. Replace Existing Gemini Client
You can either:
- **Option A**: Replace `gemini_client.py` with `gemini_client_enhanced.py`
- **Option B**: Import both and gradually migrate functions

### 3. WebSocket Integration
Update your WebSocket handler to support audio responses:

```python
import json
import base64
from gemini_client_enhanced import generate_live_audio_response

async def handle_websocket_message(websocket, message):
    data = json.loads(message)
    
    if data.get("type") == "audio_query":
        # Generate response with both text and audio
        response = await generate_live_audio_response(
            transcript_text=data.get("transcript"),
            response_modalities=["TEXT", "AUDIO"]
        )
        
        # Send back both text and audio
        response_data = {
            "type": "audio_response",
            "text": response.text,
            "audio_data": base64.b64encode(response.audio_data).decode(),
            "audio_format": response.audio_format,
            "sample_rate": response.sample_rate
        }
        
        await websocket.send(json.dumps(response_data))
```

### 4. Frontend Integration
Update your Chrome extension to handle audio responses:

```javascript
// In your content script or popup
websocket.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    if (data.type === 'audio_response') {
        // Display text response
        displayTextResponse(data.text);
        
        // Play audio response
        if (data.audio_data) {
            playAudioResponse(data.audio_data, data.sample_rate);
        }
    }
};

function playAudioResponse(base64Audio, sampleRate) {
    const audioData = atob(base64Audio);
    const audioBlob = new Blob([audioData], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const audio = new Audio(audioUrl);
    audio.play();
}
```

## Configuration Options

### Response Modalities
- `["TEXT"]` - Text response only
- `["AUDIO"]` - Audio response only  
- `["TEXT", "AUDIO"]` - Both text and audio (recommended)

### System Prompts
- `DEFAULT_SYSTEM_PROMPT` - For general shopping assistance
- `DEFAULT_AUDIO_SYSTEM_PROMPT` - Optimized for audio responses
- Custom prompts for specialized use cases

## Error Handling

The enhanced client includes robust error handling:
- Automatic fallback to text-only responses
- Graceful handling of network issues
- Proper resource cleanup for audio files

## Testing

Run the test script to verify everything works:
```bash
python test_gemini_live.py
```

This will generate sample audio files and test all functionality.

## Performance Considerations

- Audio responses are larger than text (typically 50-200KB)
- Consider caching audio responses for repeated queries
- Use appropriate response modalities based on user preferences
- Monitor API usage as audio generation may have different rate limits

## Migration Path

1. **Phase 1**: Test the enhanced client alongside existing implementation
2. **Phase 2**: Update WebSocket handlers to support audio responses
3. **Phase 3**: Update Chrome extension frontend for audio playback
4. **Phase 4**: Replace old client completely

## Troubleshooting

### Common Issues
- **Missing dependencies**: Run `pip install librosa soundfile`
- **API key issues**: Ensure `GEMINI_API_KEY` is set in `.env`
- **Audio playback**: Check browser audio permissions
- **Large responses**: Consider streaming for long audio responses

### Debug Mode
Enable debug logging by setting environment variable:
```bash
export GEMINI_DEBUG=1
```
