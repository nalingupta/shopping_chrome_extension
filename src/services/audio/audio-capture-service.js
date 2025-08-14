import { streamingLogger } from "../../utils/streaming-logger.js";

export class AudioCaptureService {
    constructor(geminiAPI) {
        // geminiAPI is actually a neutral AI connection; rename for clarity
        this.geminiAPI = geminiAPI;
        this.audioStream = null;
        this.audioWorkletNode = null;
        this.audioSource = null;
        this.silentGain = null;
        this.onAudioLevelCallback = null;
        // Local audio processing state
        this.audioContext = null;
        this.audioSessionOffsetMs = null; // session-relative base time for the first audio sample
        this.totalSamplesSent = 0; // running count for sample-accurate tsStartMs
        this._firstAudioLogEmitted = false;
    }

    async setupAudioCapture() {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true,
                },
            });
            // Initialize AudioContext if not already created
            if (!this.audioContext) {
                try {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    this.audioContext = new AC({ sampleRate: 16000 });
                } catch (_) {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    this.audioContext = new AC();
                }
            }
            return true;
        } catch (error) {
            console.error("Audio capture setup failed:", error);
            throw error;
        }
    }

    async startAudioStreaming() {
        if (!this.geminiAPI.isConnectionActive()) {
            return;
        }

        try {
            // Ensure AudioContext exists and is running
            if (!this.audioContext) {
                try {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    this.audioContext = new AC({ sampleRate: 16000 });
                } catch (_) {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    this.audioContext = new AC();
                }
            }
            if (this.audioContext.state === "suspended") {
                try {
                    await this.audioContext.resume();
                } catch (e) {
                    console.warn("AudioContext resume failed:", e);
                }
            }

            // Worklet-only path; do not use ScriptProcessor fallback
            if (!this.audioContext.audioWorklet) {
                console.error("AudioWorklet not supported in this context");
                return;
            }
            await this.startAudioWorkletProcessing();
            try {
                const sr = this.audioContext?.sampleRate;
                console.info(
                    `AudioWorklet started | sampleRate=${
                        typeof sr === "number" ? sr : "unknown"
                    } Hz`
                );
            } catch (_) {}
        } catch (error) {
            console.error("Audio streaming failed:", error);
        }
    }

    stopAudioStreaming() {
        if (this.audioWorkletNode) {
            try {
                this.audioWorkletNode.disconnect();
            } catch (_) {}
            this.audioWorkletNode = null;
        }

        if (this.silentGain) {
            try {
                this.silentGain.disconnect();
            } catch (_) {}
            this.silentGain = null;
        }

        if (this.audioSource) {
            try {
                this.audioSource.disconnect();
            } catch (_) {}
            this.audioSource = null;
        }

        streamingLogger.logInfo("🎤 Audio stream stopped");
    }

    async startAudioWorkletProcessing() {
        const processorUrl = chrome.runtime.getURL(
            "src/audio/pcm-processor.js"
        );
        await this.audioContext.audioWorklet.addModule(processorUrl);

        this.audioWorkletNode = new AudioWorkletNode(
            this.audioContext,
            "pcm-processor"
        );

        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, pcmData, maxAmplitude } = event.data;
            if (type !== "audioData") return;

            // Sample-accurate session-relative timestamps
            const numSamples = pcmData?.length || 0;
            const sampleRate = this.audioContext?.sampleRate || 16000;
            const durationMs = (numSamples / sampleRate) * 1000;
            const sessionStartMs = this.geminiAPI.getSessionStartMs?.() || null;
            if (this.audioSessionOffsetMs == null) {
                const nowRel = sessionStartMs
                    ? (performance?.now?.() || Date.now()) - sessionStartMs
                    : 0;
                // Anchor base to the start of the first chunk
                this.audioSessionOffsetMs = Math.max(0, nowRel - durationMs);
                this.totalSamplesSent = 0;
            }
            const tsStartMs =
                this.audioSessionOffsetMs +
                (this.totalSamplesSent / sampleRate) * 1000;

            // Removed one-time Phase 4 debug log

            if (this.geminiAPI.isConnectionActive()) {
                const uint8Array = new Uint8Array(pcmData.buffer);
                const base64 = btoa(String.fromCharCode(...uint8Array));
                this.geminiAPI.sendAudioPcm(
                    base64,
                    tsStartMs,
                    numSamples,
                    sampleRate
                );
                this.totalSamplesSent += numSamples;
            }

            if (maxAmplitude !== undefined) {
                this.onAudioLevelDetected(maxAmplitude);
            }
        };

        this.audioSource = this.audioContext.createMediaStreamSource(
            this.audioStream
        );
        this.audioSource.connect(this.audioWorkletNode);

        // Ensure the graph is pulled by connecting to a muted sink
        try {
            this.silentGain = this.audioContext.createGain();
            this.silentGain.gain.value = 0.0;
            this.audioWorkletNode.connect(this.silentGain);
            this.silentGain.connect(this.audioContext.destination);
        } catch (_) {}
    }

    // LEGACY (not invoked in new pipeline): retained for historical compatibility only.
    // The new architecture uses AudioWorklet exclusively.
    startScriptProcessorFallback() {
        if (!this.audioContext) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.audioContext = new AC({ sampleRate: 16000 });
            } catch (_) {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.audioContext = new AC();
            }
        }
        this.audioSource = this.audioContext.createMediaStreamSource(
            this.audioStream
        );
        const audioProcessor = this.audioContext.createScriptProcessor(
            4096,
            1,
            1
        );

        audioProcessor.onaudioprocess = (event) => {
            if (!this.geminiAPI.isConnectionActive()) return;

            const inputData = event.inputBuffer.getChannelData(0);
            const outputData = event.outputBuffer.getChannelData(0);

            for (let i = 0; i < inputData.length; i++) {
                outputData[i] = inputData[i];
            }

            let maxAmplitude = 0;
            for (let i = 0; i < inputData.length; i++) {
                const amplitude = Math.abs(inputData[i]);
                maxAmplitude = Math.max(maxAmplitude, amplitude);
            }

            this.onAudioLevelDetected(maxAmplitude);

            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const sample = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            }

            const numSamples = pcmData.length;
            const sampleRate = 16000;
            const durationMs = (numSamples / sampleRate) * 1000;
            const sessionStartMs = this.geminiAPI.getSessionStartMs?.() || null;
            if (this.audioSessionOffsetMs == null) {
                const nowRel = sessionStartMs
                    ? (performance?.now?.() || Date.now()) - sessionStartMs
                    : 0;
                this.audioSessionOffsetMs = Math.max(0, nowRel - durationMs);
                this.totalSamplesSent = 0;
            }
            const tsStartMs =
                this.audioSessionOffsetMs +
                (this.totalSamplesSent / sampleRate) * 1000;

            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            this.geminiAPI.sendAudioPcm(
                base64,
                tsStartMs,
                numSamples,
                sampleRate
            );
            this.totalSamplesSent += numSamples;
        };

        this.audioSource.connect(audioProcessor);
    }

    stopAudioProcessing() {
        this.stopAudioStreaming();

        if (this.audioStream) {
            this.audioStream.getTracks().forEach((track) => track.stop());
            this.audioStream = null;
        }
        // Reset session timestamping state
        this.audioSessionOffsetMs = null;
        this.totalSamplesSent = 0;
    }

    onAudioLevelDetected(level) {
        if (this.onAudioLevelCallback) {
            this.onAudioLevelCallback(level);
        }
    }

    setAudioLevelCallback(callback) {
        this.onAudioLevelCallback = callback;
    }

    hasAudioStream() {
        return this.audioStream !== null;
    }

    getSampleRate() {
        try {
            return this.audioContext?.sampleRate || 16000;
        } catch (_) {
            return 16000;
        }
    }
}
