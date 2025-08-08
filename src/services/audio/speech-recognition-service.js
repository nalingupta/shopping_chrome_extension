import { streamingLogger } from "../../utils/streaming-logger.js";

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

        try {
            console.debug(
                `[SpeechRec] start: lang=${this.speechRecognition.lang} interimResults=${this.speechRecognition.interimResults}`
            );
        } catch (_) {}

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
                try {
                    console.debug(
                        `[SpeechRec] interim: len=${latestTranscript.length}`
                    );
                } catch (_) {}
                this.callbacks.onInterimResult(latestTranscript);
            }

            if (hasFinalResults) {
                try {
                    console.debug(
                        `[SpeechRec] final: len=${latestTranscript.length}`
                    );
                } catch (_) {}
                try {
                    if (this.callbacks.onFinalResult) {
                        this.callbacks.onFinalResult(latestTranscript.trim());
                        console.debug(
                            `[SpeechRec] onFinalResult len=${
                                latestTranscript.trim().length
                            }`
                        );
                    }
                } catch (_) {}
                this.handleWebSpeechFinalResult();
            }
        };

        this.speechRecognition.onerror = (event) => {
            console.warn("[SpeechRec] error:", event.error);

            const timeoutErrors = ["no-speech", "network"];
            if (this.state.isListening && timeoutErrors.includes(event.error)) {
                setTimeout(() => {
                    if (this.state.isListening) {
                        this.restartSpeechRecognition();
                    }
                }, 1000);
            }
        };

        this.speechRecognition.onend = () => {
            if (this.state.isListening) {
                const now = Date.now();
                const timeSinceLastActivity =
                    now - (this.lastSpeechActivity || now);
                try {
                    console.debug(
                        `[SpeechRec] onend: isListening=${this.state.isListening} timeSinceLastActivityMs=${timeSinceLastActivity}`
                    );
                } catch (_) {}
                if (timeSinceLastActivity < 30000) {
                    setTimeout(() => {
                        if (this.state.isListening) {
                            try {
                                console.debug("[SpeechRec] restarting SR");
                            } catch (_) {}
                            this.restartSpeechRecognition();
                        }
                    }, 100);
                }
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
                    try {
                        console.debug(
                            "[SpeechRec] restart -> startLocalSpeechRecognition()"
                        );
                    } catch (_) {}
                    this.startLocalSpeechRecognition();
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
}
