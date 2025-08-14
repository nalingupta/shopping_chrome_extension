# Voice Input System – Backend‑Mediated Architecture (Current)

## Overview

The Chrome extension streams microphone PCM and static screenshots to a local backend over WebSocket. The backend performs VAD/segmentation, encodes segments, and calls the configured model (e.g., Gemini) to generate responses. The extension displays server‑provided transcripts (if emitted) and assistant responses.
Note on naming: Earlier references to an "AI handler" have been standardized to `ServerClient` to avoid confusion. Page analysis features and messages (e.g., page info broadcast/queries) have been removed from the current architecture.

-   **Primary**: Local backend WebSocket `/ws`
-   **Audio Processing**: `AudioWorkletNode` for PCM at 16 kHz (no ScriptProcessor fallback)
-   **Screen Capture**: Static `chrome.tabs.captureVisibleTab` (no debugger)
-   **Model Integration**: Done on the backend, not from the extension

## Architecture Components

### 1. Server Client (`ServerClient` in the side panel)

```javascript
class ServerClient {
    // Core: WebSocket to local backend
    // Streams PCM/imageFrame; receives acks/status/transcript/response
}
```

**Features:**

-   Realtime audio/video streaming to backend
-   Server‑side transcription and segmentation
-   Screen capture integration for multimodal AI
-   No direct Gemini calls from the extension

### 2. Backend WebSocket Service

```javascript
// The extension connects to ws://127.0.0.1:8787/ws (configurable)
// Backend proxies to the selected model (e.g., Gemini) and returns responses
```

**Core Functions:**

-   WebSocket connection to Gemini Live API
-   PCM audio encoding and streaming
-   JPEG video frame capture and streaming
-   Response processing and callback handling

### 3. Audio Processing Pipeline

```javascript
// Modern approach: AudioWorkletNode (exclusive – fallback removed)
const workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
```

**Audio Flow:**

1. Microphone → MediaStream
2. AudioContext → AudioWorkletNode/ScriptProcessorNode
3. Float32 → Int16 PCM conversion
4. Base64 encoding → WebSocket to backend

### 4. Video Processing Pipeline

```javascript
// Screen capture via Chrome API
// Static capture via chrome.tabs.captureVisibleTab → base64 JPEG to backend
```

## Message Flow Diagram (conceptual)

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
                           │ Backend     │ │Native APIs  │
                           │ (WS / SDK)  │ │- captureVisibleTab │
                           │             │ │- getUserMedia     │
                          └─────────────┘ └─────────────┘
```

## Implementation Details

### WebSocket Connection Setup

```javascript
// Extension connects to ws://127.0.0.1:8787/ws and sends init/imageFrame/audioChunk/text
// Backend decides model routing and returns transcript/response/status/ack
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
2. **Backend Required**: Local backend must be running (and configured with model credentials)
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
// AudioWorklet is used exclusively in the current architecture
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
