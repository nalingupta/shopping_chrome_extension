import { AudioCaptureService } from "./audio/audio-capture-service.js";
import { SpeechRecognitionService } from "./audio/speech-recognition-service.js";
import { EndpointDetectionService } from "./audio/endpoint-detection-service.js";
import { AudioStateManager } from "./audio/audio-state-manager.js";

export class AudioHandler {
    constructor(aiHandler, videoHandler) {
        this.aiHandler = aiHandler;
        this.videoHandler = videoHandler;

        // Audio services
        this.audioCapture = new AudioCaptureService(this.aiHandler);
        this.speechRecognition = new SpeechRecognitionService();
        this.endpointDetection = new EndpointDetectionService();
        this.stateManager = new AudioStateManager();

        // Audio state
        this.audioStreamingStarted = false;

        this.setupAudioCallbacks();
    }

    setupAudioCallbacks() {
        // Set up audio level callback
        this.audioCapture.setAudioLevelCallback((level) => {
            this.onAudioLevelDetected(level);
        });

        // Set up speech recognition callbacks
        this.speechRecognition.setCallbacks({
            onSpeechDetected: () => this.onSpeechDetected(),
            onInterimResult: (text) => {
                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.interim) {
                    callbacks.interim(text);
                }
            },
            onFinalResult: (finalText) => {
                try {
                    // Ensure finalized transcript is available to AIHandler before endUtterance
                    this.aiHandler?.setLastUserMessage(finalText);
                    // Keep UI in sync using existing pipeline
                    const callbacks = this.stateManager.getCallbacks();
                    if (callbacks.transcription)
                        callbacks.transcription(finalText);
                } catch (_) {}
            },
            onAudioStreamingStart: async () => {
                await this.startAudioStreaming();
                this.audioStreamingStarted = true;
                // Start sending video frames only while speaking
                try {
                    if (this.videoHandler) {
                        this.videoHandler.speechActive = true;
                        this.videoHandler.setVideoStreamingStarted(true);
                    }
                } catch (_) {}
                // Explicit utterance start: enable audio and inform Gemini
                try {
                    if (this.aiHandler) {
                        this.aiHandler.startUtterance();
                    }
                } catch (_) {}
            },
            onVideoStreamingStart: () => {
                // This will be handled by VideoHandler
            },
            onEndpointDetectionStart: () => this.startEndpointDetection(),
            onWebSpeechFinalResult: () => this.handleWebSpeechFinalResult(),
            onCheckOrphanedSpeech: () => this.checkForOrphanedSpeech(),
        });

        // Set up endpoint detection callbacks
        this.endpointDetection.setCallbacks({
            onSilenceDetected: () => this.handleSilenceDetected(),
            onResponseTimeout: () => {
                this.audioStreamingStarted = false;
            },
            onResponseGeneration: (source) => {
                this.audioStreamingStarted = false;
            },
            onStatus: (status, type, duration) => {
                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.status) {
                    callbacks.status(status, type, duration);
                }
            },
            onEndpointDetectionStart: () => this.startEndpointDetection(),
            onUtteranceEnded: () => this.onExplicitUtteranceEnd(),
        });
    }

    async setupAudioCapture() {
        return this.audioCapture.setupAudioCapture();
    }

    async startAudioStreaming() {
        // Defensive: attempt to resume audio context before starting
        try {
            if (this.aiHandler && this.aiHandler.geminiAPI) {
                // Ensure an AudioContext exists even in ADK mode
                if (!this.aiHandler.geminiAPI.audioContext) {
                    try {
                        await this.aiHandler.geminiAPI.initialize();
                    } catch (_) {}
                }
                if (
                    this.aiHandler.geminiAPI.audioContext &&
                    this.aiHandler.geminiAPI.audioContext.state === "suspended"
                ) {
                    await this.aiHandler.geminiAPI.audioContext.resume();
                }
            }
        } catch (e) {
            // Non-fatal; fallback to starting anyway
        }
        return this.audioCapture.startAudioStreaming();
    }

    stopAudioStreaming() {
        this.audioCapture.stopAudioStreaming();
    }

    async startAudioWorkletProcessing() {
        return this.audioCapture.startAudioWorkletProcessing();
    }

    startScriptProcessorFallback() {
        this.audioCapture.startScriptProcessorFallback();
    }

    stopAudioProcessing() {
        this.audioCapture.stopAudioProcessing();
    }

    startLocalSpeechRecognition() {
        this.resetInactivityTimer();
        this.speechRecognition.setState({
            isListening: this.stateManager.isListening(),
            audioStreamingStarted: this.audioStreamingStarted,
            videoStreamingStarted: false, // This will be managed by VideoHandler
        });
        this.speechRecognition.setSpeechBuffer(this.speechBuffer);
        this.speechRecognition.startLocalSpeechRecognition();
    }

    restartSpeechRecognition() {
        this.speechRecognition.restartSpeechRecognition();
    }

    startSpeechKeepAlive() {
        this.speechRecognition.startSpeechKeepAlive();
    }

    clearSpeechKeepAlive() {
        this.speechRecognition.clearSpeechKeepAlive();
    }

    resetInactivityTimer() {
        this.stateManager.resetInactivityTimer(() => {
            // This will be handled by MultimediaOrchestrator
            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.status) {
                callbacks.status("Session timed out", "warning", 5000);
            }
        });
    }

    clearInactivityTimer() {
        this.stateManager.clearInactivityTimer();
    }

    startEndpointDetection() {
        this.endpointDetection.setState({
            isListening: this.stateManager.isListening(),
            audioStreamingStarted: this.audioStreamingStarted,
        });
        this.endpointDetection.setSpeechBuffer(this.speechBuffer);
        this.endpointDetection.startEndpointDetection();
    }

    stopEndpointDetection() {
        this.endpointDetection.stopEndpointDetection();
    }

    resetSilenceTimer() {
        this.endpointDetection.resetSilenceTimer();
    }

    clearSilenceTimer() {
        this.endpointDetection.clearSilenceTimer();
    }

    onSpeechDetected() {
        this.endpointDetection.onSpeechDetected();
        // Optional safety: ensure video sending resumes when speech starts
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = true;
                this.videoHandler.setVideoStreamingStarted(true);
            }
        } catch (_) {}
    }

    onAudioLevelDetected(level) {
        this.endpointDetection.onAudioLevelDetected(level);
    }

    handleSilenceDetected() {
        this.endpointDetection.handleSilenceDetected();
        // Stop sending video frames when speech ends
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
            }
        } catch (_) {}
    }

    handleWebSpeechFinalResult() {
        this.endpointDetection.handleWebSpeechFinalResult();
        // Stop sending video frames when speech finalizes
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
            }
        } catch (_) {}
    }

    onExplicitUtteranceEnd() {
        // Freeze both streams and send activityEnd
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
                this.videoHandler.setVideoStreamingStarted(false);
            }
        } catch (_) {}
        // Reset speech-recognition start flags so the next utterance re-triggers start
        try {
            if (this.speechRecognition) {
                this.speechRecognition.setState({
                    audioStreamingStarted: false,
                    videoStreamingStarted: false,
                });
            }
        } catch (_) {}
        try {
            if (this.aiHandler) {
                this.aiHandler.endUtterance();
            }
        } catch (_) {}
    }

    triggerResponseGeneration(source) {
        this.audioStreamingStarted = false;
        this.endpointDetection.triggerResponseGeneration(source);
    }

    setResponseTimeout() {
        this.endpointDetection.setResponseTimeout();
    }

    clearResponseTimeout() {
        this.endpointDetection.clearResponseTimeout();
    }

    handleResponseTimeout() {
        this.audioStreamingStarted = false;
        this.endpointDetection.handleResponseTimeout();
    }

    // Callback setters
    setTranscriptionCallback(callback) {
        this.stateManager.setTranscriptionCallback(callback);
    }

    setInterimCallback(callback) {
        this.stateManager.setInterimCallback(callback);
    }

    setBotResponseCallback(callback) {
        this.stateManager.setBotResponseCallback(callback);
    }

    setStatusCallback(callback) {
        this.stateManager.setStatusCallback(callback);
    }

    setListeningStoppedCallback(callback) {
        this.stateManager.setListeningStoppedCallback(callback);
    }

    // State management
    isListening() {
        return this.stateManager.isListening();
    }

    setListeningState(listening) {
        this.stateManager.setListeningState(listening);
    }

    // Speech buffer management (needed for coordination with other handlers)
    setSpeechBuffer(speechBuffer) {
        this.speechBuffer = speechBuffer;
    }

    checkForOrphanedSpeech() {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.speechBuffer.lastWebSpeechUpdate;

        if (
            this.speechBuffer.interimText.trim() &&
            !this.speechBuffer.isGeminiProcessing &&
            timeSinceLastUpdate > 3000
        ) {
            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.transcription) {
                callbacks.transcription(this.speechBuffer.interimText.trim());
            }
            this.speechBuffer.interimText = "";
        }
    }
}
