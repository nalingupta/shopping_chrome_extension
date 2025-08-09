import { AudioCaptureService } from "./audio/audio-capture-service.js";
import DeepgramTranscriptionService from "./audio/deepgram-transcription-service.js";
import { EndpointDetectionService } from "./audio/endpoint-detection-service.js";
import { AudioStateManager } from "./audio/audio-state-manager.js";

export class AudioHandler {
    constructor(aiHandler, videoHandler) {
        this.aiHandler = aiHandler;
        this.videoHandler = videoHandler;

        // Audio services
        this.audioCapture = new AudioCaptureService(this.aiHandler);
        this.deepgram = new DeepgramTranscriptionService({
            // Defaults will be refined at start based on actual AudioContext
            sampleRate:
                (this.aiHandler &&
                    this.aiHandler.geminiAPI &&
                    this.aiHandler.geminiAPI.audioContext &&
                    this.aiHandler.geminiAPI.audioContext.sampleRate) ||
                48000,
            onDeepgramInterim: (text) => {
                this._dgSawInterim = true;
                try {
                    console.debug(
                        `[Deepgram→AudioHandler] interim len=${
                            (text || "").length
                        } streamingStarted=${this.audioStreamingStarted}`
                    );
                } catch (_) {}
                // Do not set interim text chunks to UI or speech buffer

                // On first interim, ensure audio/video streaming starts (utterance start is driven by local VAD)
                if (!this.audioStreamingStarted) {
                    try {
                        console.debug(
                            "[Deepgram→AudioHandler] first interim → startAudioStreaming (no utterance start here)"
                        );
                    } catch (_) {}
                    this.startAudioStreaming()
                        .then(() => {
                            this.audioStreamingStarted = true;
                            try {
                                if (this.videoHandler) {
                                    this.videoHandler.speechActive = true;
                                    this.videoHandler.setVideoStreamingStarted(
                                        true
                                    );
                                }
                            } catch (_) {}
                        })
                        .catch(() => {});
                }
            },
            onDeepgramFinal: (finalText, payload) => {
                try {
                    console.debug(
                        `[Deepgram→AudioHandler] final len=${
                            (finalText || "").length
                        }`
                    );
                } catch (_) {}
                try {
                    const newText =
                        typeof finalText === "string" ? finalText : "";
                    if (
                        !this._dgFinalBest ||
                        newText.length >= this._dgFinalBest.length
                    ) {
                        this._dgFinalBest = newText;
                    }
                    // Keep AI handler in sync for endUtterance, but do not finalize UI here
                    this.aiHandler?.setLastUserMessage(this._dgFinalBest);
                } catch (_) {}
            },
            onDeepgramUtteranceEnd: () => {
                try {
                    const pendingLen = (
                        this.speechBuffer?.interimText || ""
                    ).trim().length;
                    const hasFinal = !!(
                        this.aiHandler &&
                        this.aiHandler._lastUserMessage &&
                        this.aiHandler._lastUserMessage.trim()
                    );
                    console.debug(
                        `[Deepgram→AudioHandler] speech_final pendingLen=${pendingLen} hasFinal=${hasFinal}`
                    );
                } catch (_) {}
                // If no interim was seen in this utterance, ignore this end signal
                if (!this._dgSawInterim) {
                    try {
                        console.debug(
                            "[Deepgram→AudioHandler] ignore speech_final (no interim seen)"
                        );
                    } catch (_) {}
                    return;
                }
                // Mirror existing Web Speech finalization flow
                try {
                    // Ensure Gemini receives activityEnd regardless of endpoint state
                    console.debug(
                        "[Deepgram→AudioHandler] onExplicitUtteranceEnd() → endUtterance"
                    );
                    // Ensure we send the best accumulated final and emit to UI once
                    try {
                        let toEmit = "";
                        if (this._dgFinalBest) {
                            this.aiHandler.setLastUserMessage(
                                this._dgFinalBest
                            );
                            toEmit = this._dgFinalBest;
                        } else {
                            const interim = (
                                this.speechBuffer?.interimText || ""
                            ).trim();
                            if (interim) {
                                this.aiHandler.setLastUserMessage(interim);
                                toEmit = interim;
                            }
                        }
                        if (toEmit) {
                            try {
                                console.debug(
                                    `[AudioHandler] emit user final len=${toEmit.length}`
                                );
                            } catch (_) {}
                            const callbacks = this.stateManager.getCallbacks();
                            if (callbacks.transcription)
                                callbacks.transcription(toEmit);
                        }
                    } catch (_) {}
                    this.onExplicitUtteranceEnd();
                    console.debug(
                        "[Deepgram→AudioHandler] handleWebSpeechFinalResult() → endpoint detection path"
                    );
                    this.handleWebSpeechFinalResult();
                } catch (_) {}
                // Pause audio to Deepgram but keep socket alive
                try {
                    console.debug("[Deepgram→AudioHandler] pause Deepgram WS");
                    this.deepgram.pause();
                } catch (_) {}
                // Clear accumulator for next utterance
                this._dgFinalBest = "";
                this._dgSawInterim = false;
                // Clear speech buffer to avoid stale carryover into next turn or stop flow
                try {
                    if (this.speechBuffer) {
                        this.speechBuffer.interimText = "";
                        this.speechBuffer.lastWebSpeechUpdate = 0;
                        this.speechBuffer.isGeminiProcessing = false;
                    }
                } catch (_) {}
            },
            onDeepgramStateChange: (state) => {
                // Optional: map to status callback if needed
                // const cb = this.stateManager.getCallbacks().status; if (cb) cb(`Deepgram: ${state}`, 'info');
            },
            onDeepgramError: (err) => {
                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.status) {
                    callbacks.status("Deepgram error", "error", 4000);
                }
                // Keep endpoint detection active for resilience
            },
        });
        this.endpointDetection = new EndpointDetectionService();
        this.stateManager = new AudioStateManager();

        // Audio state
        this.audioStreamingStarted = false;
        this._utteranceOpen = false; // guards duplicate endUtterance
        this._dgFinalBest = ""; // accumulate best Deepgram final per utterance
        this._dgSawInterim = false; // track if any interim arrived

        this.setupAudioCallbacks();
    }

    setupAudioCallbacks() {
        // Set up audio level callback
        this.audioCapture.setAudioLevelCallback((level) => {
            this.onAudioLevelDetected(level);
        });

        // Mirror PCM frames to Deepgram when available
        this.audioCapture.setPcmFrameCallback((int16) => {
            try {
                this.deepgram.sendPcmFrame(int16);
            } catch (_) {}
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
            onUtteranceEnded: (source) => {
                // Use Deepgram as source-of-truth for utterance end
                if (source === "web_speech_final") {
                    this.onExplicitUtteranceEnd();
                } else {
                    // Ignore local silence end while Deepgram is active; fallback-only
                    try {
                        console.debug(
                            `[AudioHandler] ignore local end '${source}' while using Deepgram`
                        );
                    } catch (_) {}
                }
            },
            onSpeechStart: () => this.onLocalSpeechStart(),
        });
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

    startLocalSpeechRecognition() {
        // Start Deepgram instead of Web Speech
        this.resetInactivityTimer();
        try {
            // Refresh Deepgram sample rate from active AudioContext if present
            const sr =
                (this.aiHandler &&
                    this.aiHandler.geminiAPI &&
                    this.aiHandler.geminiAPI.audioContext &&
                    this.aiHandler.geminiAPI.audioContext.sampleRate) ||
                48000;
            this.deepgram.options.sampleRate = sr;
        } catch (_) {}

        this.deepgram.start();
        // Ensure audio capture starts immediately so Deepgram receives PCM frames
        try {
            this.startAudioStreaming();
        } catch (_) {}
    }

    restartSpeechRecognition() {
        // No-op with Deepgram (auto-managed). Could implement reconnect/backoff if needed.
    }

    startSpeechKeepAlive() {
        // No-op: Deepgram keepalive is handled internally on pause()
    }

    clearSpeechKeepAlive() {
        // No-op for Deepgram
    }

    stopTranscription() {
        try {
            this.deepgram.stop();
        } catch (_) {}
        try {
            this.audioCapture.setPcmFrameCallback(null);
        } catch (_) {}
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

    onLocalSpeechStart() {
        // Start mic if not already; open Gemini audio gate and activityStart ASAP
        // Reset utterance accumulators at the very start of a new utterance
        this._dgFinalBest = "";
        this._dgSawInterim = false;
        this._dgFinalEmitted = false;
        if (!this.audioStreamingStarted) {
            this.startAudioStreaming()
                .then(() => {
                    this.audioStreamingStarted = true;
                })
                .catch(() => {});
        }
        // Ensure the video screenshot loop is running when speech begins
        try {
            if (
                this.videoHandler &&
                typeof this.videoHandler.startScreenshotStreaming === "function"
            ) {
                if (!this.videoHandler.isVideoStreamingStarted?.()) {
                    this.videoHandler.startScreenshotStreaming();
                }
                // Gate ON: allow loop to resume sending when stable frame captured
                try {
                    this.videoHandler.speechActive = true;
                } catch (_) {}
            }
        } catch (_) {}
        // Resume Deepgram sending if it was paused after previous utterance
        try {
            if (this.deepgram) {
                this.deepgram.resume();
            }
        } catch (_) {}
        try {
            if (this.aiHandler) {
                this.aiHandler.startUtterance();
                this._utteranceOpen = true;
            }
        } catch (_) {}
        // Ensure endpoint detection state reflects streaming started
        try {
            this.endpointDetection.setState({
                isListening: this.stateManager.isListening(),
                audioStreamingStarted: true,
            });
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
        if (!this._utteranceOpen) {
            // Already ended; avoid duplicate Gemini end
            return;
        }
        try {
            if (this.videoHandler) {
                this.videoHandler.speechActive = false;
                this.videoHandler.setVideoStreamingStarted(false);
            }
        } catch (_) {}
        // Reset speech-recognition start flags so the next utterance re-triggers start
        // With Deepgram, flags are internal; nothing to reset here
        try {
            if (this.aiHandler) {
                this.aiHandler.endUtterance();
            }
        } catch (_) {}
        this._utteranceOpen = false;
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
