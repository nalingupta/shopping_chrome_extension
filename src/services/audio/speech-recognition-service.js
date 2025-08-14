import { streamingLogger } from "../../utils/streaming-logger.js";

// LEGACY (unused in new audio pipeline):
// This Web Speech API wrapper is retained for reference only.
// The current production path streams PCM via AudioWorklet and relies on server-side VAD/transcription.
// Safe to remove once we sunset the legacy UI transcription path.
export class SpeechRecognitionService {
    constructor() {
        this.speechRecognition = null;
        this.speechKeepAliveTimer = null;
        this.lastSpeechActivity = null;
        this.callbacks = {
            onSpeechDetected: null,
            onInterimResult: null,
            onFinalResult: null,
            onError: null,
            onStatus: null,
            onAudioStreamingStart: null,
            onVideoStreamingStart: null,
            onEndpointDetectionStart: null,
            onWebSpeechFinalResult: null,
        };
        this.state = {
            isListening: false,
            audioStreamingStarted: false,
            videoStreamingStarted: false,
        };
        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
        };

        // Resilient auto-restart state
        this._lastError = null;
        this._retryCount = 0;
        this._maxRetries = 5;
        this._backoffBaseMs = 300;
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

    // LEGACY: Not invoked by the new pipeline. Kept for reference/testing only.
    startLocalSpeechRecognition() {
        const SpeechRecognition =
            window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech recognition not supported");
            return;
        }

        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = "en-US";

        // Suppress SpeechRec start debug log

        this.speechRecognition.onresult = async (event) => {
            if (this.callbacks.onSpeechDetected) {
                this.callbacks.onSpeechDetected();
            }
            this.lastSpeechActivity = Date.now();

            if (!this.state.audioStreamingStarted) {
                streamingLogger.logInfo(
                    "🎤 Speech detected - starting AUDIO & VIDEO streams"
                );
                this.state.audioStreamingStarted = true;
                this.state.videoStreamingStarted = true;

                if (this.callbacks.onAudioStreamingStart) {
                    await this.callbacks.onAudioStreamingStart();
                }
                if (this.callbacks.onVideoStreamingStart) {
                    this.callbacks.onVideoStreamingStart();
                }
                if (this.callbacks.onEndpointDetectionStart) {
                    this.callbacks.onEndpointDetectionStart();
                }
            }

            let latestTranscript = "";
            let hasInterimResults = false;
            let hasFinalResults = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;

                latestTranscript += transcript;

                if (!isFinal) {
                    hasInterimResults = true;
                } else {
                    hasFinalResults = true;
                }
            }

            this.speechBuffer.interimText = latestTranscript;
            this.speechBuffer.lastWebSpeechUpdate = Date.now();

            if (hasInterimResults && this.callbacks.onInterimResult) {
                this.callbacks.onInterimResult(latestTranscript);
            }

            if (hasFinalResults) {
                try {
                    if (this.callbacks.onFinalResult) {
                        this.callbacks.onFinalResult(latestTranscript.trim());
                    }
                } catch (_) {}
                this.handleWebSpeechFinalResult();
            }
        };

        this.speechRecognition.onerror = (event) => {
            this._lastError = event?.error || null;
            
            // Handle permission-related errors
            if (this._lastError === "not-allowed") {
                console.error("[SpeechRec] Microphone permission denied. Please allow microphone access in Chrome settings.");
                if (this.callbacks.onError) {
                    this.callbacks.onError("Microphone permission denied. Please allow microphone access.");
                }
                return;
            }
            
            // Handle aborted errors (often due to permission issues or conflicts)
            if (this._lastError === "aborted") {
                console.warn("[SpeechRec] Speech recognition aborted. This may be due to permission issues or browser restrictions.");
                if (this.state.isListening && this._retryCount < this._maxRetries) {
                    this._retryCount += 1;
                    const backoff = Math.min(
                        this._backoffBaseMs * Math.pow(2, this._retryCount),
                        2000
                    );
                    console.warn(`[SpeechRec] Retrying after abort in ${backoff}ms (attempt ${this._retryCount}/${this._maxRetries})`);
                    setTimeout(() => {
                        if (this.state.isListening) {
                            this.restartSpeechRecognition();
                        }
                    }, backoff);
                }
                return;
            }
            
            const timeoutErrors = ["no-speech", "network"];
            if (
                this.state.isListening &&
                timeoutErrors.includes(this._lastError)
            ) {
                const backoff = Math.min(
                    this._backoffBaseMs * Math.pow(2, this._retryCount),
                    4000
                );
                console.warn(
                    `[SpeechRec] error: ${
                        this._lastError
                    } → retry in ${backoff}ms (attempt ${
                        this._retryCount + 1
                    }/${this._maxRetries})`
                );
                if (this._retryCount < this._maxRetries) {
                    this._retryCount += 1;
                    setTimeout(() => {
                        if (this.state.isListening) {
                            this.restartSpeechRecognition();
                        }
                    }, backoff);
                }
                return;
            }
            console.warn("[SpeechRec] error:", this._lastError);
        };

        this.speechRecognition.onend = () => {
            if (!this.state.isListening) return;
            const now = Date.now();
            const timeSinceLastActivity =
                now - (this.lastSpeechActivity || now);
            if (
                this._lastError === "network" ||
                this._lastError === "no-speech"
            ) {
                // resume with backoff (handled by onerror path already)
                return;
            }
            if (timeSinceLastActivity < 30000) {
                setTimeout(() => {
                    if (this.state.isListening) {
                        this.restartSpeechRecognition();
                    }
                }, 100);
            }
        };

        try {
            this.speechRecognition.start();
        } catch (error) {
            console.error("Failed to start speech recognition:", error);
        }
    }

    restartSpeechRecognition() {
        try {
            if (this.speechRecognition) {
                this.speechRecognition.stop();
            }

            setTimeout(() => {
                if (this.state.isListening) {
                    this.startLocalSpeechRecognition();
                    if (this._lastError) {
                        console.debug(
                            `[SpeechRec] recovered from ${this._lastError} (retries=${this._retryCount})`
                        );
                    }
                    this._lastError = null;
                    this._retryCount = 0;
                }
            }, 200);
        } catch (error) {
            console.error("Error restarting speech recognition:", error);
        }
    }

    startSpeechKeepAlive() {
        this.clearSpeechKeepAlive();
        this.lastSpeechActivity = Date.now();

        this.speechKeepAliveTimer = setInterval(() => {
            if (!this.state.isListening) {
                this.clearSpeechKeepAlive();
                return;
            }

            if (this.callbacks.onCheckOrphanedSpeech) {
                this.callbacks.onCheckOrphanedSpeech();
            }

            const now = Date.now();
            const timeSinceLastActivity =
                now - (this.lastSpeechActivity || now);

            if (timeSinceLastActivity > 30000) {
                this.restartSpeechRecognition();
            }
        }, 5000);
    }

    clearSpeechKeepAlive() {
        if (this.speechKeepAliveTimer) {
            clearInterval(this.speechKeepAliveTimer);
            this.speechKeepAliveTimer = null;
        }
    }

    handleWebSpeechFinalResult() {
        if (this.callbacks.onWebSpeechFinalResult) {
            this.callbacks.onWebSpeechFinalResult();
        }
    }

    stopSpeechRecognition() {
        if (this.speechRecognition) {
            try {
                this.speechRecognition.stop();
            } catch (error) {
                console.error("Error stopping speech recognition:", error);
            }
            this.speechRecognition = null;
        }
        this.clearSpeechKeepAlive();
    }

    isSpeechRecognitionActive() {
        return this.speechRecognition !== null;
    }

    async requestMicrophonePermission() {
        try {
            // Request microphone permission explicitly
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the stream immediately as we only needed permission
            stream.getTracks().forEach(track => track.stop());
            console.log("[SpeechRec] Microphone permission granted");
            return true;
        } catch (error) {
            console.error("[SpeechRec] Microphone permission denied:", error);
            if (this.callbacks.onError) {
                this.callbacks.onError("Microphone access denied. Please allow microphone permission in your browser.");
            }
            return false;
        }
    }

    async startWithPermissionCheck() {
        // First check if we have microphone permission
        const hasPermission = await this.requestMicrophonePermission();
        if (!hasPermission) {
            return false;
        }
        
        // Reset retry count when starting fresh
        this._retryCount = 0;
        this._lastError = null;
        
        this.startLocalSpeechRecognition();
        return true;
    }
}
