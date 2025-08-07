export class SpeechRecognitionService {
    constructor() {
        this.speechRecognition = null;
        this.speechKeepAliveTimer = null;
        this.lastSpeechActivity = null;
        this.speechDetected = false; // Flag to prevent multiple speech detection triggers
        this.isRestarting = false; // Flag to prevent multiple simultaneous restarts
    }

    startLocalSpeechRecognition() {
        // Clean up any existing speech recognition first
        if (this.speechRecognition) {
            try {
                this.speechRecognition.stop();
            } catch (error) {
                console.warn(
                    "Error stopping existing speech recognition:",
                    error
                );
            }
            this.speechRecognition = null;
        }

        // Reset speech detection flag for new session
        this.speechDetected = false;

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

        this.speechRecognition.onresult = async (event) => {
            this.lastSpeechActivity = Date.now();

            // Trigger speech detection callback only once when speech is first detected
            if (!this.speechDetected && this.onSpeechDetected) {
                this.speechDetected = true;
                this.onSpeechDetected();
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

            if (hasInterimResults && this.onInterimResult) {
                this.onInterimResult(latestTranscript);
            }

            if (hasFinalResults) {
                this.handleWebSpeechFinalResult();
            }
        };

        this.speechRecognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);

            const timeoutErrors = ["no-speech", "network", "aborted"];
            if (this.isListening && timeoutErrors.includes(event.error)) {
                setTimeout(() => {
                    if (this.isListening && !this.isRestarting) {
                        this.restartSpeechRecognition();
                    }
                }, 1000);
            }
        };

        this.speechRecognition.onend = () => {
            if (this.isListening) {
                const now = Date.now();
                const timeSinceLastActivity =
                    now - (this.lastSpeechActivity || now);

                if (timeSinceLastActivity < 30000) {
                    setTimeout(() => {
                        if (this.isListening && !this.isRestarting) {
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
        if (this.isRestarting) {
            return; // Prevent multiple simultaneous restarts
        }

        try {
            this.isRestarting = true;

            if (this.speechRecognition) {
                this.speechRecognition.stop();
            }

            setTimeout(() => {
                if (this.isListening) {
                    this.startLocalSpeechRecognition();
                }
                this.isRestarting = false;
            }, 200);
        } catch (error) {
            console.error("Error restarting speech recognition:", error);
            this.isRestarting = false;
        }
    }

    startSpeechKeepAlive() {
        this.clearSpeechKeepAlive();
        this.lastSpeechActivity = Date.now();

        this.speechKeepAliveTimer = setInterval(() => {
            if (!this.isListening) {
                this.clearSpeechKeepAlive();
                return;
            }

            if (this.checkForOrphanedSpeech) {
                this.checkForOrphanedSpeech();
            }

            const now = Date.now();
            const timeSinceLastActivity =
                now - (this.lastSpeechActivity || now);

            if (timeSinceLastActivity > 30000 && !this.isRestarting) {
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

    stopSpeechRecognition() {
        try {
            if (this.speechRecognition) {
                this.speechRecognition.stop();
                this.speechRecognition = null;
            }
        } catch (error) {
            console.warn("Error stopping speech recognition:", error);
        }
    }

    cleanup() {
        this.clearSpeechKeepAlive();
        this.stopSpeechRecognition();
        this.lastSpeechActivity = null;
        this.speechDetected = false; // Reset speech detection flag
        this.isRestarting = false; // Reset restart flag
    }

    handleWebSpeechFinalResult() {
        if (this.onFinalResult) {
            this.onFinalResult();
        }
    }

    // Callback setters
    setInterimResultCallback(callback) {
        this.onInterimResult = callback;
    }

    setFinalResultCallback(callback) {
        this.onFinalResult = callback;
    }

    setOrphanedSpeechCheckCallback(callback) {
        this.checkForOrphanedSpeech = callback;
    }

    setListeningStateCallback(callback) {
        this.isListening = callback;
    }

    setSpeechDetectedCallback(callback) {
        this.onSpeechDetected = callback;
    }
}
