# Voice Input System - Gemini Live API Integration

## Overview

The Chrome extension uses **direct integration with Gemini Live API** for voice input:

-   **Primary**: Direct WebSocket connection to Gemini Live API
-   **Audio Processing**: Native AudioWorkletNode/ScriptProcessorNode for PCM conversion
-   **Screen Capture**: Chrome debugger API for browser-only video streaming
-   **No external dependencies** - Pure Gemini integration

## Architecture Components

### 1. Gemini Voice Handler (`gemini-voice-handler.js`)

```javascript
class GeminiVoiceHandler {
    // Core: Gemini Live Streaming Service
    this.geminiService = new GeminiLiveStreamingService();
    // Local speech recognition for UI feedback only
    this.speechRecognition = new SpeechRecognition();
}
```

**Features:**

-   Real-time audio/video streaming to Gemini Live API
-   Local speech recognition for UI transcription display
-   Screen capture integration for multimodal AI
-   Direct conversation with Gemini without intermediaries

### 2. Gemini Live Streaming Service (`gemini-live-streaming.js`)

```javascript
class GeminiLiveStreamingService {
    // Direct WebSocket to Gemini Live API
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;
    this.ws = new WebSocket(wsUrl);
}
```

**Core Functions:**

-   WebSocket connection to Gemini Live API
-   PCM audio encoding and streaming
-   JPEG video frame capture and streaming
-   Response processing and callback handling

### 3. Audio Processing Pipeline

```javascript
// Modern approach: AudioWorkletNode
const workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");

// Fallback: ScriptProcessorNode
const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
```

**Audio Flow:**

1. Microphone → MediaStream
2. AudioContext → AudioWorkletNode/ScriptProcessorNode
3. Float32 → Int16 PCM conversion
4. Base64 encoding → WebSocket to Gemini

### 4. Video Processing Pipeline

```javascript
// Screen capture via Chrome API
// Using Chrome debugger API for screen capture
await chrome.debugger.attach({ tabId }, '1.3');
await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
const screenStream = await navigator.mediaDevices.getUserMedia({...});

// Frame extraction
canvas.drawImage(video, 0, 0);
canvas.toBlob((blob) => {
    // Convert to base64 JPEG → WebSocket to Gemini
});
```

## Message Flow Diagram

```
┌─────────────┐  startListening()  ┌─────────────────┐
│ Side Panel  │────────────────────│GeminiVoiceHandler│
│ (UI)        │◄──responses────────│                 │
└─────────────┘                    └─────────────────┘
                                           │
                                           │ startStreaming()
                                           ▼
                                  ┌─────────────────┐
                                  │GeminiLiveStreaming│
                                  │Service          │
                                  └─────────────────┘
                                           │
                                    ┌──────┴──────┐
                           WebSocket│             │Screen/Audio
                                   ▼             ▼
                          ┌─────────────┐ ┌─────────────┐
                          │Gemini Live  │ │Native APIs  │
                          │API          │ │- desktopCapture│
                          │(WebSocket)  │ │- getUserMedia │
                          └─────────────┘ └─────────────┘
```

## Implementation Details

### WebSocket Connection Setup

```javascript
const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

const setupMessage = {
    setup: {
        model: "models/gemini-2.0-flash-exp",
        systemInstruction: {
            parts: [{ text: "You are a helpful shopping assistant..." }],
        },
        generationConfig: {
            responseModalities: ["TEXT"],
            temperature: 0.7,
        },
    },
};
```

### Audio Data Format

```javascript
const message = {
    realtimeInput: {
        audio: {
            data: base64PCMData,
            mimeType: "audio/pcm;rate=16000",
        },
    },
};
```

### Video Data Format

```javascript
const message = {
    realtimeInput: {
        mediaChunks: [
            {
                mimeType: "image/jpeg",
                data: base64JPEGData,
            },
        ],
    },
};
```

## Browser Compatibility

| Browser | Gemini Live API   | Screen Capture    | Audio Processing   |
| ------- | ----------------- | ----------------- | ------------------ |
| Chrome  | ✅ Full support   | ✅ desktopCapture | ✅ AudioWorklet    |
| Edge    | ✅ Full support   | ❌ No capture API | ✅ AudioWorklet    |
| Firefox | ⚠️ WebSocket only | ❌ No capture API | ⚠️ ScriptProcessor |
| Safari  | ❌ CSP issues     | ❌ No capture API | ❌ Limited         |

**Recommendation**: Chrome browser required for full functionality.

## Limitations & Constraints

### Technical Limitations

1. **Chrome Required**: Screen capture only works in Chrome
2. **Internet Required**: Gemini Live API needs network connection
3. **Real-time Processing**: Continuous WebSocket connection required
4. **API Limits**: Subject to Gemini API rate limits and quotas

### Permission Requirements

1. **Microphone**: Required for audio input
2. **Screen Capture**: User must grant screen sharing permission
3. **Extension Context**: Requires proper Chrome extension permissions
4. **HTTPS**: Secure context required for media APIs

### Performance Considerations

1. **Bandwidth**: Continuous audio/video streaming
2. **Processing**: Real-time PCM conversion and video encoding
3. **Memory**: WebSocket buffers and media processing
4. **Battery**: Continuous microphone and processing usage

## Error Recovery Strategies

### Connection Failures

```javascript
this.ws.onclose = (event) => {
    if (event.code === 1006) {
        // Abnormal closure - likely auth or network issue
        this.handleReconnection();
    }
};
```

### Audio Processing Failures

```javascript
// Fallback from AudioWorklet to ScriptProcessor
if (this.audioContext.audioWorklet) {
    await this.startAudioWorkletProcessing();
} else {
    // ScriptProcessor fallback removed; AudioWorklet is used exclusively.
}
```

### Screen Capture Issues

```javascript
this.screenStream.getVideoTracks()[0].onended = () => {
    // User stopped screen sharing
    this.handleScreenSharingEnded();
};
```

## Testing & Debugging

### Quick Test Flow

1. Open extension side panel in Chrome
2. Click microphone button
3. Grant screen sharing permission
4. Say "What products do you see on this page?"
5. Verify Gemini responds with screen analysis

### Common Issues

-   **No response**: Check Gemini API key and network connection
-   **Permission denied**: Ensure microphone and screen permissions granted
-   **WebSocket errors**: Verify API key and endpoint URL
-   **Audio not streaming**: Check AudioContext state and browser compatibility

## Future Optimization Opportunities

### Performance

-   [ ] Implement intelligent frame rate adjustment
-   [ ] Add voice activity detection to reduce bandwidth
-   [ ] Optimize PCM conversion efficiency
-   [ ] Add connection pooling and retry logic

### User Experience

-   [ ] Add visual indicators for streaming status
-   [ ] Implement push-to-talk mode
-   [ ] Add audio response playback from Gemini
-   [ ] Support multiple screen/window selection

### Integration

-   [ ] Add text-to-speech for Gemini responses
-   [ ] Implement conversation history
-   [ ] Add support for Gemini multimodal responses
-   [ ] Optimize for mobile screen capture (future)
