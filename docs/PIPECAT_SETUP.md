# PipeChat Real-Time Streaming Setup

## Overview

This shopping extension uses **PipeChat** for real-time AI streaming with Gemini 2.5 Flash, providing immediate AI responses while you browse shopping websites.

**✅ API keys are now hardcoded in the extension - no configuration needed!**

## Architecture

```
┌─────────────────┐    WebRTC     ┌─────────────────┐    WebSocket    ┌─────────────────┐
│  Chrome         │◄─────────────►│  PipeChat       │◄───────────────►│  Gemini 2.5     │
│  Extension      │               │  Cloud          │                 │  Live API       │
│                 │               │                 │                 │                 │
│ • Screen Share  │               │ • Audio/Video   │                 │ • AI Processing │
│ • Microphone    │               │   Processing    │                 │ • Real-time     │
│ • WebRTC Client │               │ • Stream Relay  │                 │   Responses     │
└─────────────────┘               └─────────────────┘                 └─────────────────┘
```

## API Keys (Pre-configured)

The extension now includes hardcoded API keys:

### ✅ Gemini API Key: `AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I`
- **Purpose:** AI processing with Gemini 2.5 Flash
- **Status:** Pre-configured in `src/config/api-keys.js`

### ✅ Daily API Key: `6eba5c1efdcbfa1f34ac368e04fcdef024e7332b05b3cc4c68a8ba42d389ac25`
- **Purpose:** WebRTC streaming functionality  
- **Status:** Pre-configured in `src/config/api-keys.js`

## No Setup Required!

~~1. Open the Chrome extension~~
~~2. Click "🔧 Setup AI Streaming"~~
~~3. Enter your API keys~~

**The extension now works immediately with pre-configured API keys!**

Just:
1. **Load the extension** in Chrome
2. **Click the microphone** 
3. **Start shopping** with instant AI assistance! 🛍️

## How It Works

### Real-Time Streaming Flow

1. **User clicks microphone** → Extension requests screen sharing permission
2. **Screen + audio streaming starts** → WebRTC sends live stream to PipeChat server
3. **PipeChat processes stream** → Forwards audio/video to Gemini Live API
4. **Gemini analyzes in real-time** → Processes shopping content continuously
5. **AI responds immediately** → Responses streamed back through PipeChat
6. **User sees instant feedback** → No waiting for recording to finish

### Benefits vs Traditional Approach

| Traditional (Batch) | Real-Time Streaming |
|-------------------|-------------------|
| Record → Process → Respond | Continuous Stream Processing |
| 5-10 second delays | <1 second responses |
| Sends large video files | Efficient stream chunks |
| AI sees final recording | AI sees live browsing |
| Limited context | Full browsing context |

## Usage

1. **Start streaming** by clicking the microphone
2. **Browse shopping websites** while speaking
3. **Ask questions** like:
   - "What do you think about this laptop?"
   - "Compare these prices"
   - "Are there better deals?"
   - "What are the reviews saying?"
4. **Get instant AI responses** while browsing
5. **AI can interrupt** with proactive suggestions

## Troubleshooting

### Common Issues

**"PipeChat server not accessible"**
- Ensure server is running on localhost:7860
- Check firewall settings
- Verify .env file configuration

**"Real-time streaming failed"**
- Check both API keys are valid
- Ensure PipeChat server is running
- Try refreshing the extension

**"WebRTC connection failed"**
- Check Daily API key
- Ensure HTTPS context (required for WebRTC)
- Verify microphone permissions

### Fallback Mode

If real-time streaming fails, the extension automatically falls back to traditional voice recognition mode. You can still use voice input, but without real-time AI processing.

## Development Notes

### File Structure
```
src/services/
├── pipecat-streaming.js     # Main PipeChat integration
├── voice-handler.js         # Voice input with PipeChat support
└── screen-recorder.js       # Screen capture (fallback)

src/sidepanel/
└── shopping-assistant.js    # UI and configuration
```

### Key Classes
- `PipeCatStreamingService`: Handles WebRTC and streaming
- `VoiceInputHandler`: Manages voice input with PipeChat integration
- `ShoppingAssistant`: UI and configuration management

## Future Enhancements

- **Voice responses from AI** (Gemini Live API supports speech output)
- **Multiple shopping site optimization**
- **Product comparison overlays**
- **Price tracking integration**
- **Shopping list generation**