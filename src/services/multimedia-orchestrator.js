export class MultimediaOrchestrator {
    constructor(audioHandler, videoHandler, aiHandler) {
        this.audioHandler = audioHandler;
        this.videoHandler = videoHandler;
        this.aiHandler = aiHandler;

        // Multimedia session state
        this.isMultimediaActive = false;

        // Speech buffer for coordination between handlers
        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
            isGeminiProcessing: false,
        };
    }

    async startMultimedia() {
        if (this.isMultimediaActive) {
            return {
                success: false,
                error: "Multimedia session already active",
            };
        }

        try {
            // Initialize speech buffer
            this.speechBuffer = {
                interimText: "",
                lastWebSpeechUpdate: 0,
                isGeminiProcessing: false,
            };

            // Set speech buffer for coordination
            this.audioHandler.setSpeechBuffer(this.speechBuffer);

            // Connect to Gemini
            const geminiResult = await this.aiHandler.connectToGemini();
            if (!geminiResult.success) {
                throw new Error(
                    geminiResult.error || "Failed to connect to Gemini"
                );
            }

            // Setup video capture
            const videoResult = await this.videoHandler.setupScreenCapture();
            if (!videoResult.success) {
                throw new Error(
                    videoResult.error || "Failed to setup video capture"
                );
            }

            // Setup audio capture
            await this.audioHandler.setupAudioCapture();
            await this.startMediaStreaming();

            // Start audio processing
            this.audioHandler.startLocalSpeechRecognition();
            this.audioHandler.startEndpointDetection();
            this.audioHandler.startSpeechKeepAlive();

            // Set listening state
            this.audioHandler.setListeningState(true);
            this.videoHandler.setVideoStreamingStarted(true);
            // Ensure we start with speech inactive; will be toggled by AudioHandler callbacks
            this.videoHandler.speechActive = false;

            this.isMultimediaActive = true;

            return { success: true };
        } catch (error) {
            console.error("Failed to start multimedia session:", error);
            await this.stopMultimedia();
            return { success: false, error: error.message };
        }
    }

    async stopMultimedia() {
        if (!this.isMultimediaActive) {
            return { success: false, error: "No multimedia session active" };
        }

        try {
            // Handle any pending transcription
            if (this.speechBuffer.interimText.trim()) {
                const callbacks = this.audioHandler.stateManager.getCallbacks();
                if (callbacks.transcription) {
                    callbacks.transcription(
                        this.speechBuffer.interimText.trim()
                    );
                }
            }

            // Reset speech buffer
            this.speechBuffer = {
                interimText: "",
                lastWebSpeechUpdate: 0,
                isGeminiProcessing: false,
            };

            // Stop audio processing
            this.audioHandler.stopEndpointDetection();
            if (this.audioHandler.speechRecognition) {
                this.audioHandler.speechRecognition.stopSpeechRecognition();
            }
            this.audioHandler.stopAudioProcessing();
            this.audioHandler.clearInactivityTimer();
            this.audioHandler.clearSpeechKeepAlive();

            // Stop video processing
            this.videoHandler.stopScreenshotStreaming();
            await this.videoHandler.cleanup();

            // Disconnect from Gemini
            await this.aiHandler.disconnectFromGemini();

            // Reset states
            this.audioHandler.setListeningState(false);
            this.videoHandler.setVideoStreamingStarted(false);
            this.videoHandler.speechActive = false;
            this.audioHandler.audioStreamingStarted = false;

            this.isMultimediaActive = false;

            return { success: true };
        } catch (error) {
            console.error("Error stopping multimedia session:", error);
            this.isMultimediaActive = false;
            return { success: false, error: error.message };
        }
    }

    isMultimediaSessionActive() {
        return this.isMultimediaActive;
    }

    async startMediaStreaming() {
        // Fast path: in ADK mode, if the handler already marked ADK connected, skip waiting
        try {
            if (this.aiHandler?.isAdkMode && this.aiHandler?.isAdkConnected) {
                this.videoHandler.setVideoStreamingStarted(false);
                this.audioHandler.audioStreamingStarted = false;
                return;
            }
        } catch (_) {}

        // Provider-agnostic readiness: works for ADK or Gemini
        let waitCount = 0;
        const maxWait = 100; // up to ~10s in dev to avoid races
        while (!this.aiHandler.isConnected() && waitCount < maxWait) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            waitCount++;
        }

        if (!this.aiHandler.isConnected()) {
            throw new Error("AI connection did not complete in time");
        }

        this.videoHandler.setVideoStreamingStarted(false);
        this.audioHandler.audioStreamingStarted = false;
    }

    // Callback setters for coordination
    setTranscriptionCallback(callback) {
        this.audioHandler.setTranscriptionCallback(callback);
    }

    setInterimCallback(callback) {
        this.audioHandler.setInterimCallback(callback);
    }

    setBotResponseCallback(callback) {
        this.audioHandler.setBotResponseCallback(callback);
        // Also set up AIHandler callbacks for text message responses
        this.aiHandler.setBotResponseCallback(callback);
    }

    setStatusCallback(callback) {
        this.audioHandler.setStatusCallback(callback);
    }

    setListeningStoppedCallback(callback) {
        this.audioHandler.setListeningStoppedCallback(callback);
    }

    // State queries - use the boolean state directly
    // isMultimediaActive() method already exists above
}
