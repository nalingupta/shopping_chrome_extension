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
            this.onSpeechDetected();
        }
    }

    handleSilenceDetected() {
        if (!this.endpointDetection.isActive) {
            return;
        }

        if (this.onSilenceDetected) {
            this.onSilenceDetected();
        }
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
        if (this.onResponseTimeout) {
            this.onResponseTimeout();
        }
    }

    triggerResponseGeneration(source) {
        if (this.onResponseGeneration) {
            this.onResponseGeneration(source);
        }
    }

    // Callback setters
    setSilenceDetectedCallback(callback) {
        this.onSilenceDetected = callback;
    }

    setResponseTimeoutCallback(callback) {
        this.onResponseTimeout = callback;
    }

    setResponseGenerationCallback(callback) {
        this.onResponseGeneration = callback;
    }

    isActive() {
        return this.endpointDetection.isActive;
    }

    reset() {
        this.stopEndpointDetection();
        this.endpointDetection.lastSpeechTime = null;
    }
}
