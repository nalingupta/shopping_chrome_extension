# Voice Input System – Backend‑Mediated Architecture (Current)

## Overview

The extension streams microphone PCM and static screenshots to a local backend over WebSocket (`ws://127.0.0.1:8787/ws`). The backend performs VAD/segmentation, encodes segments, and calls the configured model (e.g., Gemini) to generate responses. The extension displays server‑provided transcripts and responses.

## Components

- `ServerClient` (`src/services/ai/server-client.js`) – High‑level client wrapping `ServerWsClient` for WS transport.
- `ServerWsClient` (`src/services/server-ws-client.js`) – Manages the browser WebSocket and message serialization.
- `AudioCaptureService` (`src/services/audio/audio-capture-service.js`) – Captures PCM via `AudioWorkletNode` at 16 kHz; timestamps are session‑relative and sample‑accurate.
- `VideoHandler` facade (`src/services/video-session.js`) – Orchestrates static capture via `ScreenCaptureService` and pipelines frames to backend before preview.
- Backend (`server/main.py`) – FastAPI WS endpoint `/ws`; aligns frames and audio, performs segmentation, encodes, and emits `transcript`, `segment`, `response`, and periodic `status`.

## Connection Lifecycle

1. The side panel connects to the backend via `ServerClient.connect()`.
2. On start of a multimedia session, the client sends `init` with `{ sessionId, sampleRate, fps }`.
3. The server acknowledges with `{ type: "ack", ackType: "init" }` and may send `{ type: "config", captureFps }`.
4. Client streams `audioChunk` and `imageFrame` messages continuously during the session.
5. On stop, client sends `{ type: "control", action: "activeSessionClosed" }` but keeps the WS open.

## Message Formats (Client → Backend)

- Init: `{ type: "init", sessionId, sampleRate, fps, seq }`
- Frame: `{ type: "imageFrame", tsMs, mime: "image/jpeg", base64, seq }`
- Audio: `{ type: "audioChunk", tsStartMs, numSamples, sampleRate, mime: "audio/pcm", base64, seq }`
- Text: `{ type: "text", text, tsMs, seq }`
- Links: `{ type: "links", links: string[], tsMs, seq }`
- Tab Info: `{ type: "tabInfo", info: object, tsMs, seq }`
- Control: `{ type: "control", action, seq }` (e.g., `activeSessionClosed`, `forceSegmentClose`)

## Message Formats (Backend → Client)

- `ack` – `{ type: "ack", seq, ackType }` for each inbound message type
- `config` – `{ type: "config", captureFps }`
- `status` – periodic updates (`ready`, `speaking`, `segment_closed`, `busy`, `idle`)
- `transcript` – `{ type: "transcript", text, isFinal, tsMs }`
- `segment` – `{ type: "segment", segmentStartMs, segmentEndMs, transcript, encoded, frameCount, audioMs, fps, responseText?, chosenPath }`
- `response` – `{ type: "response", text }`
- `error` – `{ type: "error", message }`

## Audio Pipeline

- Uses `AudioWorkletNode` exclusively; no ScriptProcessor fallback.
- Target sample rate 16 kHz; if the context differs, the actual sample rate is included in messages.
- Per‑chunk timestamps are derived from a session‑relative base and `totalSamplesSent` for sample‑accurate `tsStartMs`.

## Video Pipeline (Static Capture)

- Uses `chrome.tabs.captureVisibleTab` to capture the active tab of the last‑focused normal window.
- Frames are sent before preview updates each tick.
- Default FPS 1; server may override via `config.captureFps`.

## Error Recovery & Dev Notes

- During development, running the server with `--reload` may cause mid‑connection closes (CLOSE 1005/1006). This is expected when the worker restarts.
- Client currently does not auto‑reconnect; reconnection/backoff is a planned enhancement.
- Restricted pages/minimized windows and rate limits are handled with short backoff and resume behavior for static capture.

## Browser Compatibility

- Chrome/Chromium supported. Static capture uses `captureVisibleTab` (not `desktopCapture`).

## Future Work

- Client auto‑reconnect/backoff strategy in `ServerWsClient`.
- Adaptive frame rate and improved batching.
- Additional diagnostics around WS lifecycle.

