import { AudioCaptureService } from "./audio/audio-capture-service.js";
// Local endpoint detection and audio state manager removed in Phase 3

export class AudioHandler {
    constructor(aiHandler, videoHandler) {
        this.aiHandler = aiHandler;
        this.videoHandler = videoHandler;

        // Audio services
        this.audioCapture = new AudioCaptureService(this.aiHandler);
        this.endpointDetection = null;
        this.stateManager = {
            callbacks: {
                transcription: null,
                interim: null,
                botResponse: null,
                status: null,
                listeningStopped: null,
            },
            isListening: false,
            setTranscriptionCallback: (cb) =>
                (this.stateManager.callbacks.transcription = cb),
            setInterimCallback: (cb) =>
                (this.stateManager.callbacks.interim = cb),
            setBotResponseCallback: (cb) =>
                (this.stateManager.callbacks.botResponse = cb),
            setStatusCallback: (cb) =>
                (this.stateManager.callbacks.status = cb),
            setListeningStoppedCallback: (cb) =>
                (this.stateManager.callbacks.listeningStopped = cb),
            getCallbacks: () => this.stateManager.callbacks,
            isListening: () => this.stateManager.isListening,
            setListeningState: (v) => (this.stateManager.isListening = !!v),
            resetInactivityTimer: () => {},
            clearInactivityTimer: () => {},
        };

        // Audio state
        this.audioStreamingStarted = false;

        this.setupAudioCallbacks();
    }

    setupAudioCallbacks() {
        // Set up audio level callback
        this.audioCapture.setAudioLevelCallback((level) => {
            this.onAudioLevelDetected(level);
        });

        // WebSpeech API has been removed; audio streaming begins directly when session starts.

        // Endpoint detection removed; backend handles segmentation
    }

    async setupAudioCapture() {
        return this.audioCapture.setupAudioCapture();
    }

    async startAudioStreaming() {
        // Defensive: attempt to resume audio context before starting
        try {
            if (
                this.aiHandler &&
                this.aiHandler.geminiAPI &&
                this.aiHandler.geminiAPI.audioContext &&
                this.aiHandler.geminiAPI.audioContext.state === "suspended"
            ) {
                await this.aiHandler.geminiAPI.audioContext.resume();
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

    // WebSpeech API methods removed (startLocalSpeechRecognition, restart, keep-alive)

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

    startEndpointDetection() {}

    stopEndpointDetection() {}

    resetSilenceTimer() {}

    clearSilenceTimer() {}

    onSpeechDetected() {
        // No-op; backend handles speech detection
        // Optional safety: ensure video sending resumes when speech starts
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = true;
                this.videoHandler.setVideoStreamingStarted(true);
            }
        } catch (_) {}
    }

    onAudioLevelDetected(level) {
        // Level available for UI effects if needed; no gating
    }

    handleSilenceDetected() {
        // No-op; backend handles silence
        // Stop sending video frames when speech ends
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
            }
        } catch (_) {}
    }

    handleWebSpeechFinalResult() {
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
            }
        } catch (_) {}
    }

    onExplicitUtteranceEnd() {
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
                this.videoHandler.setVideoStreamingStarted(false);
            }
        } catch (_) {}
        try {
            this.aiHandler?.endUtterance?.();
        } catch (_) {}
    }

    triggerResponseGeneration(source) {
        this.audioStreamingStarted = false;
        // No-op; backend triggers response generation
    }

    setResponseTimeout() {
        // No-op
    }

    clearResponseTimeout() {
        // No-op
    }

    handleResponseTimeout() {
        this.audioStreamingStarted = false;
        // No-op
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
        // WebSpeech removed; no-op
    }
}
