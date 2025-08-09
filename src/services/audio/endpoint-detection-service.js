import { streamingLogger } from "../../utils/streaming-logger.js";

export class EndpointDetectionService {
    constructor() {
        this.endpointDetection = {
            isActive: false,
            lastSpeechTime: null,
            silenceThreshold: 2000, // 2 seconds of silence as fallback
            audioLevelThreshold: 0.01, // Minimum audio level to consider as speech
            silenceTimer: null,
            audioLevelHistory: [], // Track recent audio levels
            audioLevelWindow: 10, // Number of samples to average
            responseTimeout: null, // Timeout for Gemini response
            responseTimeoutDuration: 10000, // 10 seconds timeout
        };

        this.callbacks = {
            onSilenceDetected: null,
            onResponseTimeout: null,
            onResponseGeneration: null,
            onStatus: null,
            onEndpointDetectionStart: null,
            onSpeechStart: null,
        };

        this.state = {
            isListening: false,
            audioStreamingStarted: false,
            isSpeechActive: false,
        };

        this.speechBuffer = {
            isGeminiProcessing: false,
            interimText: "",
        };
    }

    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    setState(state) {
        this.state = { ...this.state, ...state };
    }

    setSpeechBuffer(speechBuffer) {
        this.speechBuffer = { ...this.speechBuffer, ...speechBuffer };
    }

    startEndpointDetection() {
        this.endpointDetection.isActive = true;
        this.endpointDetection.lastSpeechTime = Date.now();
        this.resetSilenceTimer();
    }

    stopEndpointDetection() {
        this.endpointDetection.isActive = false;
        this.clearSilenceTimer();
        this.clearResponseTimeout();
        this.endpointDetection.audioLevelHistory = [];
        streamingLogger.logInfo("Endpoint detection stopped");
    }

    resetSilenceTimer() {
        this.clearSilenceTimer();

        this.endpointDetection.silenceTimer = setTimeout(() => {
            this.handleSilenceDetected();
        }, this.endpointDetection.silenceThreshold);
    }

    clearSilenceTimer() {
        if (this.endpointDetection.silenceTimer) {
            clearTimeout(this.endpointDetection.silenceTimer);
            this.endpointDetection.silenceTimer = null;
        }
    }

    onSpeechDetected() {
        this.endpointDetection.lastSpeechTime = Date.now();
        this.resetSilenceTimer();
    }

    onAudioLevelDetected(level) {
        if (!this.endpointDetection.isActive) return;

        this.endpointDetection.audioLevelHistory.push(level);
        if (
            this.endpointDetection.audioLevelHistory.length >
            this.endpointDetection.audioLevelWindow
        ) {
            this.endpointDetection.audioLevelHistory.shift();
        }

        const averageLevel =
            this.endpointDetection.audioLevelHistory.reduce(
                (a, b) => a + b,
                0
            ) / this.endpointDetection.audioLevelHistory.length;

        if (averageLevel > this.endpointDetection.audioLevelThreshold) {
            // Rising above threshold indicates speech activity; only fire once per utterance
            if (!this.state.isSpeechActive) {
                this.state.isSpeechActive = true;
                if (this.callbacks.onSpeechStart) {
                    try {
                        this.callbacks.onSpeechStart();
                    } catch (_) {}
                }
            }
            this.onSpeechDetected();
        }
    }

    handleSilenceDetected() {
        if (
            !this.endpointDetection.isActive ||
            !this.state.audioStreamingStarted
        ) {
            return;
        }

        streamingLogger.logInfo("Silence detection triggered");
        this.triggerResponseGeneration("silence_detection");
    }

    handleWebSpeechFinalResult() {
        if (
            !this.endpointDetection.isActive ||
            !this.state.audioStreamingStarted
        ) {
            return;
        }

        streamingLogger.logInfo("Web Speech API final result");
        this.triggerResponseGeneration("web_speech_final");
    }

    triggerResponseGeneration(source) {
        if (this.speechBuffer.isGeminiProcessing) {
            return;
        }

        streamingLogger.logInfo(`Response generation triggered (${source})`);

        this.speechBuffer.isGeminiProcessing = true;
        this.setResponseTimeout();

        // Proactively mark speech ended for video sending purposes
        try {
            if (this.callbacks?.onStatus) {
                // no-op; status already handled
            }
            // We don’t directly know VideoHandler here; AudioHandler reacts to this via callbacks and stops sending
        } catch (_) {}

        if (this.callbacks.onStatus) {
            this.callbacks.onStatus("Processing speech...", "info");
        }

        if (this.callbacks.onResponseGeneration) {
            this.callbacks.onResponseGeneration(source);
        }

        // Explicit utterance end: notify higher layer (AudioHandler) to stop media gates and send activityEnd
        try {
            if (this.callbacks?.onUtteranceEnded) {
                this.callbacks.onUtteranceEnded(source);
            }
            // Reset speech active flag on utterance end
            this.state.isSpeechActive = false;
        } catch (_) {}
    }

    setResponseTimeout() {
        this.clearResponseTimeout();

        this.endpointDetection.responseTimeout = setTimeout(() => {
            this.handleResponseTimeout();
        }, this.endpointDetection.responseTimeoutDuration);
    }

    clearResponseTimeout() {
        if (this.endpointDetection.responseTimeout) {
            clearTimeout(this.endpointDetection.responseTimeout);
            this.endpointDetection.responseTimeout = null;
        }
    }

    handleResponseTimeout() {
        this.speechBuffer.isGeminiProcessing = false;
        this.speechBuffer.interimText = "";

        if (this.callbacks.onStatus) {
            this.callbacks.onStatus("Ready for next input", "info");
        }

        if (this.callbacks.onResponseTimeout) {
            this.callbacks.onResponseTimeout();
        }
    }

    isEndpointDetectionActive() {
        return this.endpointDetection.isActive;
    }

    getEndpointDetectionState() {
        return this.endpointDetection;
    }
}
