// DeepgramTranscriptionService: standalone, non-SDK live transcription over WebSocket
// - Independent of Gemini and Web Speech API
// - Streams Int16 PCM mono at configurable sample rate (default 16 kHz)
// - Emits interim and final transcripts; uses `speech_final` for utterance end

export class DeepgramTranscriptionService {
    constructor() {
        this.deepgramWs = null;
        this.isConnected = false;
        this.isStreamingAudio = false;
        this.keepAliveTimer = null;
        this.keepAliveIntervalMs = 30000;

        this.audioContext = null;
        this.mediaStream = null;
        this.audioSourceNode = null;
        this.audioWorkletNode = null;
        this.scriptProcessorNode = null;

        this.config = {
            apiKey: null,
            model: "nova-3",
            language: "en-US",
            sampleRate: 16000,
            channels: 1,
            interimResults: true,
            smartFormat: true,
            endpointMs: 500,
            encoding: "linear16", // Raw 16-bit PCM, little-endian
        };

        this.callbacks = {
            onOpen: null,
            onClose: null,
            onError: null,
            onInterim: null,
            onFinal: null,
            onUtteranceEnd: null,
        };

        this.pendingPcmSamples = new Int16Array(0);
        this.targetChunkSamples = Math.floor(
            (this.config.sampleRate * 20) / 1000
        ); // ~20ms
    }

    async initialize(options = {}) {
        this.config = { ...this.config, ...options };
        this.targetChunkSamples = Math.floor(
            (this.config.sampleRate * 20) / 1000
        );

        if (!this.audioContext) {
            const AudioContextCtor =
                window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextCtor({
                sampleRate: this.config.sampleRate,
            });
        }

        if (this.audioContext.audioWorklet) {
            const workletUrl = chrome.runtime.getURL(
                "src/audio/pcm-processor.js"
            );
            await this.audioContext.audioWorklet.addModule(workletUrl);
        }
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    async connect(apiKey) {
        if (this.isConnected) return { success: true };

        this.config.apiKey = apiKey || this.config.apiKey;
        if (!this.config.apiKey) {
            const error = new Error("Deepgram API key is required");
            this._emitError(error);
            return { success: false, error: error.message };
        }

        const params = new URLSearchParams({
            model: this.config.model,
            language: this.config.language,
            encoding: this.config.encoding,
            sample_rate: String(this.config.sampleRate),
            channels: String(this.config.channels),
            interim_results: String(this.config.interimResults),
            smart_format: String(this.config.smartFormat),
            endpointing: String(this.config.endpointMs),
            access_token: this.config.apiKey,
        });

        const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

        return new Promise((resolve) => {
            try {
                this.deepgramWs = new WebSocket(wsUrl);
                this.deepgramWs.binaryType = "arraybuffer";

                this.deepgramWs.onopen = () => {
                    this.isConnected = true;
                    this._startKeepAlive();
                    if (this.callbacks.onOpen) this.callbacks.onOpen();
                    resolve({ success: true });
                };

                this.deepgramWs.onmessage = (event) =>
                    this._handleDeepgramMessage(event);

                this.deepgramWs.onerror = (event) => {
                    const error = new Error("Deepgram WebSocket error");
                    this._emitError(error, event);
                };

                this.deepgramWs.onclose = () => {
                    this.isConnected = false;
                    this._stopKeepAlive();
                    if (this.callbacks.onClose) this.callbacks.onClose();
                };
            } catch (err) {
                this._emitError(err);
                resolve({ success: false, error: err.message });
            }
        });
    }

    async start() {
        if (!this.isConnected) {
            return { success: false, error: "Deepgram not connected" };
        }

        if (!this.mediaStream) {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: this.config.sampleRate,
                },
            });
        }

        this.audioSourceNode = this.audioContext.createMediaStreamSource(
            this.mediaStream
        );

        if (this.audioContext.audioWorklet) {
            await this._startWorkletStreaming();
        } else {
            this._startScriptProcessorStreaming();
        }

        this.isStreamingAudio = true;
        return { success: true };
    }

    pause() {
        this.isStreamingAudio = false;
    }

    resume() {
        if (this.isConnected && this.mediaStream) {
            this.isStreamingAudio = true;
        }
    }

    async stop() {
        this.isStreamingAudio = false;

        if (this.audioWorkletNode) {
            try {
                this.audioWorkletNode.disconnect();
            } catch (_) {}
            this.audioWorkletNode = null;
        }

        if (this.scriptProcessorNode) {
            try {
                this.scriptProcessorNode.disconnect();
            } catch (_) {}
            this.scriptProcessorNode = null;
        }

        if (this.audioSourceNode) {
            try {
                this.audioSourceNode.disconnect();
            } catch (_) {}
            this.audioSourceNode = null;
        }

        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach((t) => t.stop());
            } catch (_) {}
            this.mediaStream = null;
        }

        this.pendingPcmSamples = new Int16Array(0);

        if (this.deepgramWs) {
            try {
                this.deepgramWs.close();
            } catch (_) {}
            this.deepgramWs = null;
        }

        this._stopKeepAlive();

        if (this.audioContext && this.audioContext.state === "running") {
            try {
                await this.audioContext.suspend();
            } catch (_) {}
        }

        this.isConnected = false;
        return { success: true };
    }

    // Internal methods
    async _startWorkletStreaming() {
        this.audioWorkletNode = new AudioWorkletNode(
            this.audioContext,
            "pcm-processor"
        );
        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, pcmData } = event.data || {};
            if (type === "audioData") this._handlePcmFrame(pcmData);
        };
        this.audioSourceNode.connect(this.audioWorkletNode);
    }

    _startScriptProcessorStreaming() {
        const bufferSize = 4096;
        this.scriptProcessorNode = this.audioContext.createScriptProcessor(
            bufferSize,
            1,
            1
        );
        this.scriptProcessorNode.onaudioprocess = (ev) => {
            const input = ev.inputBuffer.getChannelData(0);
            const pcm = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
                const sample = Math.max(-1, Math.min(1, input[i]));
                pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            }
            this._handlePcmFrame(pcm);
        };
        this.audioSourceNode.connect(this.scriptProcessorNode);
    }

    _handlePcmFrame(int16Pcm) {
        if (
            !this.isConnected ||
            !this.isStreamingAudio ||
            !this.deepgramWs ||
            this.deepgramWs.readyState !== WebSocket.OPEN
        ) {
            return;
        }

        if (!(int16Pcm instanceof Int16Array)) return;

        if (this.pendingPcmSamples.length === 0) {
            this.pendingPcmSamples = int16Pcm;
        } else {
            const combined = new Int16Array(
                this.pendingPcmSamples.length + int16Pcm.length
            );
            combined.set(this.pendingPcmSamples, 0);
            combined.set(int16Pcm, this.pendingPcmSamples.length);
            this.pendingPcmSamples = combined;
        }

        while (this.pendingPcmSamples.length >= this.targetChunkSamples) {
            const chunk = this.pendingPcmSamples.slice(
                0,
                this.targetChunkSamples
            );
            this.pendingPcmSamples = this.pendingPcmSamples.slice(
                this.targetChunkSamples
            );
            try {
                this.deepgramWs.send(chunk.buffer);
            } catch (err) {
                this._emitError(err);
                break;
            }
        }
    }

    _handleDeepgramMessage(event) {
        try {
            const text =
                event.data instanceof ArrayBuffer
                    ? new TextDecoder().decode(new Uint8Array(event.data))
                    : String(event.data);
            let message;
            try {
                message = JSON.parse(text);
            } catch (_) {
                return;
            }

            if (
                message.type === "Results" ||
                message.metadata ||
                message.channel
            ) {
                const isFinal = this._extractBoolean(message, [
                    "is_final",
                    "final",
                ]);
                const isSpeechFinal = this._extractBoolean(message, [
                    "speech_final",
                ]);

                const alt = this._extractAlternative(message);
                const transcript = alt?.transcript || "";

                if (transcript) {
                    if (isFinal === false && this.callbacks.onInterim) {
                        this.callbacks.onInterim(transcript, message);
                    } else if (isFinal === true && this.callbacks.onFinal) {
                        this.callbacks.onFinal(transcript, message);
                    }
                }

                if (isSpeechFinal === true && this.callbacks.onUtteranceEnd) {
                    this.callbacks.onUtteranceEnd(message);
                }
            }
        } catch (err) {
            this._emitError(err);
        }
    }

    _extractBoolean(obj, keys) {
        for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(obj, k))
                return Boolean(obj[k]);
        }
        return undefined;
    }

    _extractAlternative(message) {
        if (
            message.channel &&
            Array.isArray(message.channel.alternatives) &&
            message.channel.alternatives[0]
        ) {
            return message.channel.alternatives[0];
        }
        if (Array.isArray(message.alternatives) && message.alternatives[0]) {
            return message.alternatives[0];
        }
        return null;
    }

    _startKeepAlive() {
        this._stopKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (
                !this.deepgramWs ||
                this.deepgramWs.readyState !== WebSocket.OPEN
            )
                return;
            try {
                const keepAlive = JSON.stringify({ type: "KeepAlive" });
                this.deepgramWs.send(keepAlive);
            } catch (_) {}
        }, this.keepAliveIntervalMs);
    }

    _stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    _emitError(err, rawEvent) {
        if (this.callbacks.onError) {
            this.callbacks.onError(err, rawEvent);
        } else {
            // eslint-disable-next-line no-console
            console.error("Deepgram error:", err);
        }
    }
}

// Convenience factory with provided API key (development-only)
export function createDeepgramServiceWithKey() {
    const svc = new DeepgramTranscriptionService();
    // Key provided by user for development usage
    svc.config.apiKey = "5151d8dfa74e9e298e49f5852bc1d9f881868778";
    return svc;
}
