export class MultimediaOrchestrator {
    constructor(audioHandler, videoHandler, serverClient) {
        this.audioHandler = audioHandler;
        this.videoHandler = videoHandler;
        this.serverClient = serverClient;

        // Multimedia session state
        this.isMultimediaActive = false;

        // Speech buffer for coordination between handlers (legacy fields retained; backend owns gating)
        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
            isServerProcessing: false,
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
                isServerProcessing: false,
            };

            // Set speech buffer for coordination
            this.audioHandler.setSpeechBuffer(this.speechBuffer);

            // Setup audio capture first to learn actual sample rate
            await this.audioHandler.setupAudioCapture();

            // Connect to server with real sample rate and default FPS
            const sr =
                this.audioHandler?.audioCapture?.getSampleRate?.() ?? 16000;
            const geminiResult = await this.serverClient.connect({
                sampleRate: sr,
            });
            if (!geminiResult.success) {
                throw new Error(
                    geminiResult.error || "Failed to connect to AI server"
                );
            }

            // Wire server status updates to video handler (apply server FPS override once if needed)
            this.serverClient.setStreamingUpdateCallback?.((update) => {
                try {
                    if (
                        update &&
                        update.type === "config" &&
                        typeof update.captureFps === "number"
                    ) {
                        this.videoHandler.applyServerCaptureFps(
                            update.captureFps
                        );
                    }
                } catch (_) {}
            });

            // Setup video capture
            const videoResult = await this.videoHandler.setupScreenCapture();
            if (!videoResult.success) {
                throw new Error(
                    videoResult.error || "Failed to setup video capture"
                );
            }

            // Ensure WS is ready
            await this.startMediaStreaming();

            // Start audio streaming immediately (no Web Speech dependency)
            await this.audioHandler.startAudioStreaming();

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
                const callbacks = this.audioHandler.getCallbacks?.() || {};
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
                isServerProcessing: false,
            };

            // Stop audio processing
            this.audioHandler.stopAudioProcessing();
            this.audioHandler.clearInactivityTimer();

            // Stop video processing
            this.videoHandler.stopScreenshotStreaming();
            await this.videoHandler.cleanup();

            // Disconnect from server
            await this.serverClient.disconnect();

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
        let waitCount = 0;
        while (!this.serverClient.isConnected() && waitCount < 50) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            waitCount++;
        }

        if (!this.serverClient.isConnected()) {
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
        // Also set up server client callbacks for text message responses
        this.serverClient.setBotResponseCallback(callback);
    }

    setStatusCallback(callback) {
        this.audioHandler.setStatusCallback(callback);
    }

    setListeningStoppedCallback(callback) {
        this.audioHandler.setListeningStoppedCallback(callback);
    }

    // Speech activity events (frontend VAD)
    setSpeechActivityCallbacks(callbacks) {
        this.audioHandler.setSpeechActivityCallbacks(callbacks);
    }

    // State queries - use the boolean state directly
    // isMultimediaActive() method already exists above
}
