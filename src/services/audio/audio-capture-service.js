import { streamingLogger } from "../../utils/streaming-logger.js";

export class AudioCaptureService {
    constructor(geminiAPI) {
        this.geminiAPI = geminiAPI;
        this.audioStream = null;
        this.audioWorkletNode = null;
        this.audioSource = null;
        this.onAudioLevelCallback = null;
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

            return true;
        } catch (error) {
            console.error("Audio capture setup failed:", error);
            throw error;
        }
    }

    async startAudioStreaming() {
        if (!this.geminiAPI.isGeminiConnectionActive()) {
            return;
        }

        try {
            // Ensure AudioContext is active before starting processing
            if (
                this.geminiAPI.geminiAPI.audioContext &&
                this.geminiAPI.geminiAPI.audioContext.state === "suspended"
            ) {
                try {
                    await this.geminiAPI.geminiAPI.audioContext.resume();
                } catch (e) {
                    console.warn("AudioContext resume failed:", e);
                }
            }

            if (this.geminiAPI.geminiAPI.audioContext.audioWorklet) {
                await this.startAudioWorkletProcessing();
                streamingLogger.logInfo(
                    "🎤 Audio stream started (AudioWorklet)"
                );
            } else {
                console.warn("AudioWorklet not supported, using fallback");
                this.startScriptProcessorFallback();
                streamingLogger.logInfo(
                    "🎤 Audio stream started (ScriptProcessor)"
                );
            }
        } catch (error) {
            console.error("Audio streaming failed:", error);
            this.startScriptProcessorFallback();
            streamingLogger.logInfo("🎤 Audio stream started (fallback)");
        }
    }

    stopAudioStreaming() {
        if (this.audioWorkletNode) {
            this.audioWorkletNode.disconnect();
            this.audioWorkletNode = null;
        }

        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }

        streamingLogger.logInfo("🎤 Audio stream stopped");
    }

    async startAudioWorkletProcessing() {
        const processorUrl = chrome.runtime.getURL(
            "src/audio/pcm-processor.js"
        );
        await this.geminiAPI.geminiAPI.audioContext.audioWorklet.addModule(
            processorUrl
        );

        this.audioWorkletNode = new AudioWorkletNode(
            this.geminiAPI.geminiAPI.audioContext,
            "pcm-processor"
        );

        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, pcmData, maxAmplitude } = event.data;

            if (
                type === "audioData" &&
                this.geminiAPI.isGeminiConnectionActive() &&
                this.geminiAPI.geminiAPI.isAudioInputEnabled()
            ) {
                const uint8Array = new Uint8Array(pcmData.buffer);
                const base64 = btoa(String.fromCharCode(...uint8Array));
                this.geminiAPI.sendAudioData(base64);

                if (maxAmplitude !== undefined) {
                    this.onAudioLevelDetected(maxAmplitude);
                }
            }
        };

        this.audioSource =
            this.geminiAPI.geminiAPI.audioContext.createMediaStreamSource(
                this.audioStream
            );
        this.audioSource.connect(this.audioWorkletNode);
    }

    startScriptProcessorFallback() {
        this.audioSource =
            this.geminiAPI.geminiAPI.audioContext.createMediaStreamSource(
                this.audioStream
            );
        const audioProcessor =
            this.geminiAPI.geminiAPI.audioContext.createScriptProcessor(
                4096,
                1,
                1
            );

        audioProcessor.onaudioprocess = (event) => {
            if (
                !this.geminiAPI.isGeminiConnectionActive() ||
                !this.geminiAPI.geminiAPI.isAudioInputEnabled()
            )
                return;

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

            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            this.geminiAPI.sendAudioData(base64);
        };

        this.audioSource.connect(audioProcessor);
    }

    stopAudioProcessing() {
        this.stopAudioStreaming();

        if (this.audioStream) {
            this.audioStream.getTracks().forEach((track) => track.stop());
            this.audioStream = null;
        }
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
}
