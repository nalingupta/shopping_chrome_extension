# Shopping Chrome Extension

An AI-powered shopping assistant Chrome extension with voice and visual input capabilities.

## Features

-   **Voice Input**: Speak to the assistant using your microphone
-   **Visual Context**: The assistant can see what's on your screen to provide relevant shopping advice
-   **AI-Powered**: Uses a local backend server that calls the configured multimodal model (e.g., Gemini) for intelligent responses
-   **Cross-Window Synchronization**: Conversation history and state are synchronized across all Chrome windows
-   **Real-time Updates**: Changes in one window are immediately reflected in all other windows

## Cross-Window Synchronization

The extension now features seamless cross-window conversation synchronization:

### What's Synchronized

-   **Conversation History**: All chat messages are shared across windows
-   **AI Context**: The assistant maintains context across all windows
-   **Welcome Screen State**: UI state is consistent across windows

### How It Works

-   Uses `chrome.storage.sync` for cross-window data sharing
-   Real-time updates via Chrome's storage change events
-   Automatic migration from old localStorage data
-   Broadcast messaging for immediate UI updates

### Benefits

-   Start a conversation in one window, continue in another
-   AI remembers context from previous windows
-   Consistent experience across all Chrome windows
-   No lost conversations when switching windows

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

## Usage

1. Click the extension icon to open the side panel
2. Use voice input by clicking the microphone button
3. Type messages in the text input
4. The assistant will analyze your screen and provide shopping advice

## Development

The extension uses a unified conversation management system:

-   `UnifiedConversationManager`: Single source of truth for all conversation data
-   Cross-window synchronization via Chrome storage APIs
-   Real-time UI updates across all windows
-   Automatic data migration from legacy systems

## Technical Details

### Architecture (server-mediated)

-   **Backend (FastAPI)**: WebSocket `/ws` for realtime media; health endpoint `/healthz`.
    -   Server VAD-based segmentation with 2s transcript wait; server-side FPS downsampling and ffmpeg mux.
    -   Fallback hierarchy: Video→Audio→Text; backend invokes the configured model via its SDK.
    -   Env-driven knobs: `CAPTURE_FPS`, `ENCODE_FPS`, Server VAD params.
-   **Background Script**: Handles messaging and state management; no direct model calls from the extension.
-   **Side Panel**: Main UI; streams image frames and PCM audio to backend via WebSocket.
-   **Content Script**: Captures page info.
-   **Services**: Audio capture, screenshot capture, server WS client, UI orchestration.

### Storage

-   `chrome.storage.sync`: Cross-window conversation data
-   `chrome.storage.local`: Extension-specific settings
-   Automatic cleanup and migration utilities

### Local development

-   Conda env: `shopping-chrome-ext` (Python 3.11). Install deps:
    -   `pip install "fastapi[all]" uvicorn python-dotenv google-genai`
-   ffmpeg required (installed via conda-forge).
-   Backend env in `server/.env`:
    -   If using Gemini: `GEMINI_API_KEY=...`
    -   Optional: `CAPTURE_FPS=1` (default), `ENCODE_FPS=1.0`, Server VAD env vars
-   Start server (recommended for WS stability):
    -   `lsof -nP -iTCP:8787 -sTCP:LISTEN -t | xargs -r kill`
    -   `conda run -n shopping-chrome-ext env SERVER_LOG_LEVEL=INFO PYTHONUNBUFFERED=1 python -m uvicorn server.main:app --host 127.0.0.1 --port 8787 --log-level info`
-   Health check:
    -   `curl http://127.0.0.1:8787/healthz`
-   Extension CSP must allow `ws://127.0.0.1:*`.
-   Expected logs when testing voice:
    -   Client: `Connected to AI`, `AudioWorklet started | sampleRate=...`
    -   Server: `WebSocket /ws [accepted]`, `SEG window ...`, `ENCODE result ...`, `chosen_path=...`

### Notes

-   Web Speech API is retained in the codebase for legacy reference but is not used in the current pipeline; the backend owns Server VAD/segmentation.
-   Client is ready to consume `{type:"transcript"}` messages from the server; interim transcripts will be provided after Deepgram integration.
