import { AudioCaptureService } from "./audio/audio-capture-service.js";
import { SimpleVad } from "./audio/simple-vad.js";
import { FEATURES } from "../config/features.js";
import { DEBUG_VAD } from "../config/debug.js";
// Local endpoint detection and audio state manager removed in Phase 3

export class AudioHandler {
    constructor(serverClient, videoHandler) {
        this.serverClient = serverClient;
        this.videoHandler = videoHandler;

        // Audio services
        this.audioCapture = new AudioCaptureService(this.serverClient);
        this.endpointDetection = null;
        // Frontend VAD (UI/orchestration only)
        this.simpleVad = null;
        this.speechActivityCallbacks = { onStart: null, onEnd: null };
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

        // Initialize SimpleVad if enabled
        try {
            if (FEATURES?.FRONTEND_VAD?.enabled) {
                this.simpleVad = new SimpleVad({ ...FEATURES.FRONTEND_VAD });
                this.simpleVad.setCallbacks({
                    onStart: () => {
                        // Internal effect
                        this.onSpeechDetected();
                        // External callback if provided
                        try {
                            this.speechActivityCallbacks?.onStart?.();
                        } catch (_) {}
                        if (DEBUG_VAD) {
                            try {
                                console.log("speech:active", true);
                            } catch (_) {}
                        }
                    },
                    onEnd: (info) => {
                        // Internal effect
                        this.handleSilenceDetected();
                        // External callback if provided
                        try {
                            this.speechActivityCallbacks?.onEnd?.(info);
                        } catch (_) {}
                        if (DEBUG_VAD) {
                            try {
                                console.log("speech:active", false);
                            } catch (_) {}
                        }
                    },
                });

                // Wire audio frame updates into VAD
                this.audioCapture.setAudioFrameCallback(
                    (level, blockMs, tsStartMs) => {
                        try {
                            this.simpleVad?.update(level, blockMs, tsStartMs);
                        } catch (_) {}
                    }
                );
            }
        } catch (_) {}
    }

    async setupAudioCapture() {
        return this.audioCapture.setupAudioCapture();
    }

    async startAudioStreaming() {
        return this.audioCapture.startAudioStreaming();
    }

    stopAudioStreaming() {
        this.audioCapture.stopAudioStreaming();
    }

    async startAudioWorkletProcessing() {
        return this.audioCapture.startAudioWorkletProcessing();
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
            this.serverClient?.endUtterance?.();
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
    setSpeechActivityCallbacks(callbacks) {
        if (callbacks && typeof callbacks === "object") {
            this.speechActivityCallbacks.onStart =
                typeof callbacks.onStart === "function"
                    ? callbacks.onStart
                    : null;
            this.speechActivityCallbacks.onEnd =
                typeof callbacks.onEnd === "function" ? callbacks.onEnd : null;
        }
    }
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
