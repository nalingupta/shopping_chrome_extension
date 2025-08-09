// DeepgramTranscriptionService (standalone, non-SDK, raw WebSocket)
// - Independent from Gemini/Web Speech code paths
// - Sends Int16 PCM frames over WebSocket
// - Keeps socket open across utterances; uses keepalives during silence

import { API_CONFIG } from "../../config/api-keys.js";

const DEFAULT_DEEPGRAM_OPTIONS = {
    model: "nova-3",
    language: "en-US",
    sampleRate: 48000,
    channels: 1,
    interimResults: true,
    smartFormat: true,
    endpointingMs: 350,
    keepaliveIntervalMs: 4000,
};

export class DeepgramTranscriptionService {
    constructor(options = {}) {
        this.options = { ...DEFAULT_DEEPGRAM_OPTIONS, ...options };

        // Public callbacks (no-ops by default)
        this.onDeepgramInterim = this.options.onDeepgramInterim || (() => {});
        this.onDeepgramFinal = this.options.onDeepgramFinal || (() => {});
        this.onDeepgramUtteranceEnd =
            this.options.onDeepgramUtteranceEnd || (() => {});
        this.onDeepgramStateChange =
            this.options.onDeepgramStateChange || (() => {});
        this.onDeepgramError = this.options.onDeepgramError || (() => {});

        // Internal state
        this.deepgramWebSocket = null;
        this.isPaused = false;
        this.keepaliveTimer = null;
        this.lastAudioSentAt = 0;
    }

    get isConnected() {
        return (
            this.deepgramWebSocket &&
            this.deepgramWebSocket.readyState === WebSocket.OPEN
        );
    }

    async start() {
        if (this.isConnected) return;
        this._emitState("connecting");

        const {
            model,
            language,
            sampleRate,
            channels,
            interimResults,
            smartFormat,
            endpointingMs,
        } = this.options;

        // Build Deepgram listen URL with query params
        const params = new URLSearchParams({
            model: String(model),
            language: String(language),
            encoding: "linear16",
            sample_rate: String(sampleRate),
            channels: String(channels),
            interim_results: String(Boolean(interimResults)),
            smart_format: String(Boolean(smartFormat)),
            endpointing: String(endpointingMs),
        });

        const finalUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

        try {
            // In browsers, authenticate using Sec-WebSocket-Protocol subprotocol: ['token', <API_KEY>]
            this.deepgramWebSocket = new WebSocket(finalUrl, [
                "token",
                API_CONFIG.DEEPGRAM_API_KEY,
            ]);

            this.deepgramWebSocket.onopen = () => {
                this._log("WebSocket connected");
                this._emitState("connected");
                // Start keepalive to avoid idle close until first audio arrives
                this._startKeepalive();
            };

            this.deepgramWebSocket.onmessage = (event) => {
                this._handleMessage(event.data);
            };

            this.deepgramWebSocket.onerror = (err) => {
                this._log("WebSocket error", err);
                this.onDeepgramError(err);
            };

            this.deepgramWebSocket.onclose = () => {
                this._log("WebSocket closed");
                this._clearKeepalive();
                this._emitState("closed");
            };
        } catch (error) {
            this._log("Failed to open WebSocket", error);
            this.onDeepgramError(error);
            this._emitState("error");
            throw error;
        }
    }

    async stop() {
        this._emitState("stopping");
        this._clearKeepalive();
        if (this.deepgramWebSocket) {
            try {
                this.deepgramWebSocket.close();
            } catch (_) {
                // ignore
            }
            this.deepgramWebSocket = null;
        }
        this._emitState("closed");
    }

    pause() {
        if (!this.isConnected) return;
        if (this.isPaused) return;
        this.isPaused = true;
        this._emitState("paused");
        this._startKeepalive();
    }

    resume() {
        if (!this.isConnected) return;
        if (!this.isPaused) return;
        this.isPaused = false;
        this._emitState("connected");
        // Keep keepalive running; it self-throttles when audio is flowing
    }

    // Send Int16Array PCM frame (mono, 16-bit, LE) sized ~10-20ms for low latency
    sendPcmFrame(int16PcmFrame) {
        if (!this.isConnected) return;
        if (this.isPaused) return; // do not send audio while paused
        if (!(int16PcmFrame instanceof Int16Array)) {
            this._log("Ignoring non-Int16Array audio frame");
            return;
        }
        try {
            this.deepgramWebSocket.send(int16PcmFrame.buffer);
            this.lastAudioSentAt = Date.now();
        } catch (error) {
            this._log("Failed to send audio frame", error);
            this.onDeepgramError(error);
        }
    }

    _handleMessage(data) {
        // Deepgram emits JSON text frames for messages (results/metadata/errors)
        let payload;
        try {
            payload =
                typeof data === "string"
                    ? JSON.parse(data)
                    : JSON.parse(new TextDecoder().decode(data));
        } catch (_) {
            return;
        }

        if (payload && payload.type === "Results") {
            const channelObj =
                payload.channel ||
                (Array.isArray(payload.channels) ? payload.channels[0] : null);
            const alt =
                channelObj && Array.isArray(channelObj.alternatives)
                    ? channelObj.alternatives[0]
                    : null;
            const transcript =
                alt && typeof alt.transcript === "string" ? alt.transcript : "";
            const isFinal = Boolean(payload.is_final);
            const isSpeechFinal = Boolean(payload.speech_final);

            if (transcript) {
                if (isFinal) {
                    this.onDeepgramFinal(transcript, payload);
                } else {
                    this.onDeepgramInterim(transcript, payload);
                }
            }

            if (isSpeechFinal) {
                this.onDeepgramUtteranceEnd(payload);
            }
            return;
        }

        // Other message types (e.g., Metadata, Warning, Error)
        if (payload && payload.type === "Error") {
            this.onDeepgramError(payload);
        }
    }

    _startKeepalive() {
        this._clearKeepalive();
        const interval = Math.max(
            2000,
            Number(this.options.keepaliveIntervalMs) || 4000
        );
        this.keepaliveTimer = setInterval(() => {
            if (!this.isConnected) return;
            const now = Date.now();
            const idleMs = now - (this.lastAudioSentAt || 0);
            const shouldSend = this.isPaused || idleMs > 1500;
            if (!shouldSend) return;
            try {
                const msg = JSON.stringify({ type: "KeepAlive" });
                this.deepgramWebSocket.send(msg);
            } catch (error) {
                this._log("Keepalive send failed", error);
            }
        }, interval);
    }

    _clearKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }

    _emitState(state) {
        this.onDeepgramStateChange(state);
    }

    _log(...args) {
        console.log("[Deepgram]", ...args);
    }
}

export default DeepgramTranscriptionService;
