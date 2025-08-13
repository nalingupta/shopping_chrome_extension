# Screen Recording (Static Capture)

The extension performs continuous static screen capture during listening sessions and streams JPEG frames to the local backend, which aligns them with audio to produce segments for the Gemini model.

## How It Works

1. **Listening Start**: When the user turns the mic on (listening mode), the system begins continuous screen capture.
2. **Static Screen Capture**: Uses `chrome.tabs.captureVisibleTab` to grab the visible area of the active tab in the last‑focused normal window.
3. **Audio Capture**: High‑quality PCM audio is streamed concurrently.
4. **Backend Processing**: The backend aligns frames and audio by timestamps, and encodes segments (video/audio/image+text) for Gemini.
5. **UI Preview**: A lightweight preview canvas shows the latest frames at the capture FPS.

## Technical Implementation

### Components

-   **VideoHandler**: Orchestrates capture loop and prioritizes backend send before preview updates.
-   **ScreenCaptureService**: Routes between static capture (default) and legacy debugger path via feature flag.
-   **StaticScreenshotService**: Executes `chrome.tabs.captureVisibleTab` and applies fallback rules/backoff.
-   **StaticWindowTracker**: Tracks the last‑focused normal window and active tab across rapid switches.
-   **AIHandler/ServerWsClient**: Streams frames/audio to the backend over WebSocket.

### Key Features

-   **Continuous During Listening**: Capture runs continuously while the mic is on (not gated by speech activity).
-   **Capture Rate**: Default 1 FPS for static capture. The server can suggest a value, but Chrome may effectively limit `captureVisibleTab` to ~1 FPS.
-   **Timestamp Synchronization**: Frames and audio share a session clock for perfect alignment.
-   **Backend Priority**: Each tick sends the frame to the backend first; preview updates after.
-   **Error Handling**: Graceful fallbacks, skip-on-error, and automatic resume.

## Usage

### In Extension Context

Screen capture starts automatically when listening begins and stops when listening ends.

### Testing

Developer checks during listening:

-   Verify WebSocket connects and a `config` message may provide `captureFps`.
-   Expect frames to be sent at ~1 FPS (or server suggestion when feasible) and preview to update at the same cadence.
-   Switching tabs/windows rapidly should always capture the visible tab in the last‑focused normal window.

## Permissions Required

The extension manifest includes these permissions:

-   `tabs`
-   `host_permissions: ["<all_urls>"]`
-   Microphone permissions (for audio streaming)

## Data Formats

-   **Frames**: JPEG (quality 80) base64 (no data URL prefix) via WebSocket `{ type: "imageFrame", tsMs, mime: "image/jpeg", base64 }`.
-   **Audio**: PCM Int16 mono at 16 kHz via WebSocket `{ type: "audioChunk", tsStartMs, numSamples, sampleRate, base64 }`.

## Performance Considerations

-   Static capture via `chrome.tabs.captureVisibleTab` is effectively ~1 FPS on Chrome; higher rates may be rate‑limited.
-   Preview is throttled to the capture FPS.
-   Automatic cleanup releases intervals and listeners on stop.

## Error Handling

-   Restricted/minimized/incognito/file‑scheme disallowed: skip tick with one‑line reason; resume next tick.
-   Rate‑limit/permission errors: apply short backoff (≈1.5s), log a warning, then resume.
-   Transient failures do not stop streaming; repeated hard failures are handled conservatively.

## Browser Compatibility

-   **Chrome/Chromium**: Supported via `chrome.tabs.captureVisibleTab`.
-   **Restricted Pages**: `chrome://`, `chrome-extension://`, Chrome Web Store pages, disallowed `file://`, and incognito (without permission) are not captured.

## Future Enhancements

Potential improvements:

-   Variable frame rates based on activity
-   Multiple screen/window selection
-   Video compression options
-   Cloud storage integration
-   Real-time streaming capabilities
