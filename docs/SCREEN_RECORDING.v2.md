# Screen Recording (Static Capture) – Current Implementation

The extension performs continuous static screen capture during listening sessions and streams JPEG frames to the local backend over WebSocket. The backend aligns frames with audio to produce segments.

## How It Works

1. Listening start toggles continuous static capture.
2. Static screenshots are taken via `chrome.tabs.captureVisibleTab` from the last‑focused normal window’s active tab.
3. Frames are timestamped using the session clock and sent to the backend first; the local preview is updated after send.
4. The backend periodically returns `status` and may send a `config` with `captureFps` to guide client capture rate.

## Technical Implementation

### Components

- `VideoHandler` (facade in `src/services/video-session.js`): Orchestrates capture cycle.
- `ScreenCaptureService` (`src/services/screen-capture-service.js`): Static‑only capture stack.
- `StaticScreenshotService` (`src/services/screen-capture/static-screenshot-service.js`): Invokes `captureVisibleTab`, handles errors/backoff.
- `StaticWindowTracker` (`src/services/screen-capture/static-window-tracker.js`): Tracks last‑focused window and active tab.
- `ServerClient` (`src/services/ai/server-client.js` → `ServerWsClient`): Sends frames/audio to backend over WS.

### Key Behaviors

- Continuous during listening; not gated by frontend speech activity.
- Default capture rate is 1 FPS (`DEFAULT_CAPTURE_FPS`). The server can suggest another FPS via a `config` message `{ type: "config", captureFps }`.
- Timestamp synchronization: frames are sent with session‑relative timestamps if available.
- Backend priority: on each tick, the frame is sent to the backend before updating the local preview canvas.
- Error handling: restricted pages, minimized windows, or rate limits are detected; a short backoff is applied and capture resumes automatically. Where possible, a white frame substitute may be used to maintain cadence.

## Data Formats

- Frame to backend:
  - `{ type: "imageFrame", tsMs, mime: "image/jpeg", base64 }`
- Audio to backend (handled by audio pipeline):
  - `{ type: "audioChunk", tsStartMs, numSamples, sampleRate, mime: "audio/pcm", base64 }`

## Permissions

- `tabs`
- `host_permissions: ["<all_urls>"]`
- Microphone permission (audio pipeline)

## Performance Notes

- `chrome.tabs.captureVisibleTab` is effectively ~1 FPS on Chrome; higher requested FPS may be rate‑limited by the browser.
- Preview is throttled to the active capture FPS.
- Automatic cleanup stops timers and listeners when capture stops.

## Window/Tab Behavior

- Always targets the active tab of the last‑focused normal window. Rapid tab/window switches are handled by `StaticWindowTracker`.
- Restricted/blocked contexts (e.g., `chrome://`, `chrome-extension://`, Chrome Web Store, disallowed `file://`, or incognito without allowed access) will skip capture with backoff.

## Testing

- Verify a `config` message may arrive with `captureFps`.
- Expect ~1 FPS frames unless server suggests otherwise.
- Check preview updates match capture cadence.

## Future Enhancements

- Adaptive frame rate based on activity.
- Additional capture options and compression controls.
- Optional cloud export of captured segments.

