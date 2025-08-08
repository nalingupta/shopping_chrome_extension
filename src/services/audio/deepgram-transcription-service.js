import { API_CONFIG } from "../../config/api-keys.js";
import { streamingLogger } from "../../utils/streaming-logger.js";

export class DeepgramTranscriptionService {
    constructor() {
        this.ws = null;
        this.isOpen = false;
        this.keepAliveTimer = null;
        this.callbacks = {
            onSpeechDetected: null,
            onInterimResult: null,
            onAudioStreamingStart: null,
            onVideoStreamingStart: null,
            onEndpointDetectionStart: null,
            onWebSpeechFinalResult: null,
            onCheckOrphanedSpeech: null,
        };

        this.state = {
            isListening: false,
            audioStreamingStarted: false,
            videoStreamingStarted: false,
        };

        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
            isGeminiProcessing: false,
        };

        this.config = {
            model: "nova-3",
            language: "en-US",
            smart_format: true,
            interim_results: true,
            encoding: "linear16",
            sample_rate: null,
            channels: 1,
        };

        this.streamEpochMs = null;
        this.sentAnyAudio = false;
        this.bufferedInt16 = new Int16Array(0);
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    setState(state) {
        this.state = { ...this.state, ...state };
    }

    setSpeechBuffer(speechBuffer) {
        this.speechBuffer = speechBuffer;
    }

    async startLocalSpeechRecognition() {
        // Establish WS connection; sample rate must be provided via setState beforehand
        try {
            const sr = this.config.sample_rate;
            if (!sr && window?.AudioContext) {
                // Best effort: attempt to read from a shared AudioContext if exposed
                try {
                    const ac = window?.audioContext || null;
                    if (ac?.sampleRate) this.config.sample_rate = ac.sampleRate;
                } catch (_) {}
            }
            await this.connect();
            if (this.callbacks.onEndpointDetectionStart) {
                this.callbacks.onEndpointDetectionStart();
            }
        } catch (e) {
            streamingLogger.logError(
                "deepgram_connect",
                e?.message || String(e)
            );
        }
    }

    restartSpeechRecognition() {
        this.stopSpeechRecognition();
        this.startLocalSpeechRecognition();
    }

    startSpeechKeepAlive() {
        this.clearSpeechKeepAlive();
        // Keep the socket open between utterances
        this.keepAliveTimer = setInterval(() => {
            try {
                if (this.isOpen && this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: "KeepAlive" }));
                }
            } catch (_) {}
        }, 10000);
    }

    clearSpeechKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    handleWebSpeechFinalResult() {
        // Map legacy hook to Deepgram endpoint handling path
        // No-op: this will be driven by speech_final events
    }

    stopSpeechRecognition() {
        this.clearSpeechKeepAlive();
        try {
            this.ws?.close();
        } catch (_) {}
        this.ws = null;
        this.isOpen = false;
        this.sentAnyAudio = false;
        this.streamEpochMs = null;
        this.bufferedInt16 = new Int16Array(0);
    }

    isSpeechRecognitionActive() {
        return this.isOpen;
    }

    async connect() {
        if (this.ws && this.isOpen) return;

        const url = this.buildWsUrl();
        const key = API_CONFIG.DEEPGRAM_API_KEY || "";
        // Use WebSocket subprotocol auth for browsers: ['token', KEY]
        this.ws = key ? new WebSocket(url, ["token", key]) : new WebSocket(url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            this.isOpen = true;
            streamingLogger.logInfo("🔊 Deepgram connection opened");
        };

        this.ws.onmessage = (evt) => {
            if (typeof evt.data === "string") {
                this.handleJsonMessage(evt.data);
            }
        };

        this.ws.onerror = (err) => {
            streamingLogger.logError(
                "deepgram_ws_error",
                String(err?.message || err)
            );
        };

        this.ws.onclose = (evt) => {
            this.isOpen = false;
            streamingLogger.logInfo(
                `🔊 Deepgram connection closed${
                    evt?.code ? ` (code ${evt.code})` : ""
                }`
            );
        };
    }

    sendAudioFrame(int16Frame) {
        if (!this.isOpen) return;
        if (!this.streamEpochMs) this.streamEpochMs = Date.now();
        // Do not trigger start from Deepgram; start is governed by local VAD in AudioHandler

        // Coalesce ~20ms to reduce WS overhead
        this.bufferedInt16 = this.concatInt16(this.bufferedInt16, int16Frame);
        const minSamples = Math.max(
            1,
            Math.floor(this.config.sample_rate * 0.02)
        );
        if (this.bufferedInt16.length >= minSamples) {
            const toSend = this.bufferedInt16;
            this.bufferedInt16 = new Int16Array(0);
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(toSend.buffer);
                }
            } catch (_) {}
        }
    }

    handleJsonMessage(jsonStr) {
        let msg;
        try {
            msg = JSON.parse(jsonStr);
        } catch (_) {
            return;
        }

        if (msg.type === "Results" && msg.channel?.alternatives?.length) {
            const alt = msg.channel.alternatives[0];
            const text = alt.transcript || "";
            const isFinal = !!msg.is_final;
            const speechFinal = !!msg.speech_final;

            if (!isFinal && text && this.callbacks.onInterimResult) {
                // Update shared speech buffer for coordination
                if (this.speechBuffer) {
                    this.speechBuffer.interimText = text;
                    this.speechBuffer.lastWebSpeechUpdate = Date.now();
                }
                this.callbacks.onInterimResult(text);
            }
            if (isFinal && text && this.callbacks.onInterimResult) {
                if (this.speechBuffer) {
                    this.speechBuffer.interimText = text;
                    this.speechBuffer.lastWebSpeechUpdate = Date.now();
                }
                // Ensure UI shows the finalized text too (existing UI listens to interim/final differently)
                this.callbacks.onInterimResult(text);
            }

            if (speechFinal) {
                // Endpoint reached: mark as final and trigger app's utterance end flow
                if (this.callbacks.onWebSpeechFinalResult) {
                    this.callbacks.onWebSpeechFinalResult();
                }
            }

            // Latency metric based on last word end time
            const words = alt.words || [];
            if (words.length && this.streamEpochMs) {
                const last = words[words.length - 1];
                if (typeof last.end === "number") {
                    const spokenEndMs =
                        this.streamEpochMs + Math.round(last.end * 1000);
                    const latencyMs = Math.max(0, Date.now() - spokenEndMs);
                    streamingLogger.logMetric("deepgram_latency_ms", latencyMs);
                }
            }
        } else if (msg.type === "Error") {
            streamingLogger.logError("deepgram_msg_error", JSON.stringify(msg));
        }
    }

    buildWsUrl() {
        const params = new URLSearchParams({
            model: this.config.model,
            language: this.config.language,
            smart_format: String(this.config.smart_format),
            interim_results: String(this.config.interim_results),
            encoding: this.config.encoding,
            sample_rate: String(this.config.sample_rate || 16000),
            channels: String(this.config.channels),
        });

        // Auth is provided via WS subprotocol; do not append token as query param
        return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    }

    concatInt16(a, b) {
        if (!a || a.length === 0) return new Int16Array(b);
        const out = new Int16Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    }
}
