# Server-mediated Architecture

This extension streams timestamped image frames and PCM audio to a local backend over WebSocket. The backend segments speech (VAD), encodes aligned audio+frames into WebM at a server-chosen FPS, and calls Gemini 2.5 Flash via the Google GenAI SDK. Responses are sent back to the extension.

## Components

-   Backend (FastAPI)
    -   `GET /healthz`
    -   `WS /ws`
    -   Segmentation: VAD with 2s transcript wait timeout
    -   Encoding: ffmpeg (VP9/Opus), ENCODE_FPS downsampling
    -   Fallback: Video → Audio → Text (never skip Gemini)
    -   Env-driven knobs (see below)
-   Extension
    -   Streams JPEG frames at server-configured capture FPS
    -   Streams Int16 PCM at 16kHz mono
    -   Sends only final transcripts (interims are UI-only)
    -   Renders backend `response` messages in the UI

## WebSocket Protocol

Client → Server

-   `init`: `{ type:"init", sessionId, fps, sampleRate, seq }`
-   `imageFrame`: `{ type:"imageFrame", seq, tsMs, mime:"image/jpeg", base64 }`
-   `audioChunk`: `{ type:"audioChunk", seq, tsStartMs, numSamples, sampleRate, mime:"audio/pcm", base64 }`
-   `transcript`: `{ type:"transcript", seq, tsMs, isFinal:true, text }`
-   `text`: `{ type:"text", seq, tsMs, text }`
-   `control`: `{ type:"control", action:"forceSegmentClose" }` (testing only)

Server → Client

-   `ack`: `{ type:"ack", seq, ackType }`
-   `config`: `{ type:"config", captureFps }`
-   `status`: `{ type:"status", state:"ready"|"speaking"|"segment_closed"|"busy", ... }`
-   `segment`: `{ type:"segment", segmentStartMs, segmentEndMs, transcript?, encoded, frameCount?, audioMs?, fps?, responseText?, error? }`
-   `response`: `{ type:"response", text }` (UI-ready)

## Timestamps and Alignment

-   Single session clock from the client (relative ms)
-   `audioChunk.tsStartMs` + `numSamples` + `sampleRate` define exact coverage per chunk
-   `imageFrame.tsMs` marks frame capture time
-   Backend slices audio for `[segmentStart, segmentEnd]` and selects frames near uniform sampling instants for ENCODE_FPS (e.g., 2 FPS), adjusting last frame duration to match audio length

## VAD and Transcript Wait

-   VAD params (defaults): `frame_ms=30`, `min_speech_ms=300`, `end_silence_ms=800`, `pre_roll_ms=200`, `post_roll_ms=300`, `amplitude_threshold=0.02`
-   On segment close, wait up to 2s for a final transcript overlapping the window; if none arrives, proceed without it

## Fallback Hierarchy

1. If frames exist and video mux succeeds: call Gemini with Video + transcript
2. Else if audio present: call Gemini with Audio (WAV) + transcript
3. Else: call Gemini with transcript-only

The backend always returns a `response` message for the UI.

## Environment Variables

-   `GEMINI_API_KEY`: required
-   `CAPTURE_FPS`: capture FPS sent to client (default 10)
-   `ENCODE_FPS`: server-side encoding FPS (default 2.0)
-   `VAD_FRAME_MS`, `VAD_MIN_SPEECH_MS`, `VAD_END_SILENCE_MS`, `VAD_PRE_ROLL_MS`, `VAD_POST_ROLL_MS`, `VAD_AMPLITUDE_THRESHOLD`
-   `VAD_SAMPLE_RATE`: default 16000
-   `MAX_FRAMES_BUFFER`, `MAX_AUDIO_CHUNKS`: backpressure caps

## Local Dev Notes

-   Conda env: `shopping-chrome-ext` (Python 3.11)
-   Install: `fastapi uvicorn[standard] websockets pydantic python-dotenv google-genai ffmpeg-python webrtcvad soundfile pillow`
-   ffmpeg required (installed via conda-forge)
-   Start: `CAPTURE_FPS=10 uvicorn server.main:app --port 8787 --reload`
-   Extension CSP must allow `ws://127.0.0.1:*`
