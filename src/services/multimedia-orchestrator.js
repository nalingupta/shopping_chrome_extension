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

        // Hover links forwarding state
        this._linksIntervalId = null;
        this._latestLinks = [];
        this._latestCaptureTsAbsMs = null;
        this._sessionStartWallMs = null;

        try {
            chrome.storage.local.get(["sessionClock"], (res) => {
                try {
                    const wall = res?.sessionClock?.sessionStartWallMs;
                    if (typeof wall === "number") this._sessionStartWallMs = wall;
                } catch (_) {}
            });
            chrome.storage.onChanged.addListener((changes, ns) => {
                if (ns === "local" && changes.sessionClock) {
                    try {
                        const wall = changes.sessionClock.newValue?.sessionStartWallMs;
                        if (typeof wall === "number") this._sessionStartWallMs = wall;
                    } catch (_) {}
                }
            });
            chrome.runtime.onMessage.addListener((msg) => {
                try {
                    if (msg?.type === "SESSION_STARTED" && typeof msg.sessionStartWallMs === "number") {
                        this._sessionStartWallMs = msg.sessionStartWallMs;
                    } else if (msg?.type === "HOVER_CAPTURE_BUCKET_LINKS") {
                        if (Array.isArray(msg.links)) this._latestLinks = msg.links;
                        if (typeof msg.captureTsAbsMs === "number") this._latestCaptureTsAbsMs = msg.captureTsAbsMs;
                    }
                } catch (_) {}
            });
        } catch (_) {}
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

            // Begin ACTIVE session (send init) using the real sample rate.
            // WebSocket is expected to be already connected by lifecycle manager.
            const sr = this.audioHandler?.audioCapture?.getSampleRate?.() ?? 16000;
            const activeStart = await this.serverClient.beginActiveSession({ sampleRate: sr });
            if (!activeStart.success) {
                throw new Error(activeStart.error || "Failed to start active session");
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

            // Start 500ms links forwarding loop
            try {
                this._startLinksForwarding();
            } catch (_) {}

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

            // End ACTIVE session without closing the WebSocket
            await this.serverClient.endActiveSession();

            // Reset states
            this.audioHandler.setListeningState(false);
            this.videoHandler.setVideoStreamingStarted(false);
            this.videoHandler.speechActive = false;
            this.audioHandler.audioStreamingStarted = false;

            this.isMultimediaActive = false;

            // Stop links forwarding loop
            try {
                this._stopLinksForwarding();
            } catch (_) {}

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

MultimediaOrchestrator.prototype._startLinksForwarding = function () {
    if (this._linksIntervalId) return;
    const tick = async () => {
        try {
            if (!this.isMultimediaActive) return;
            if (!this.serverClient?.isConnectionActive?.()) return;
            if (!Array.isArray(this._latestLinks) || this._latestLinks.length === 0) return;
            const wall = typeof this._sessionStartWallMs === "number" ? this._sessionStartWallMs : null;
            const capAbs = typeof this._latestCaptureTsAbsMs === "number" ? this._latestCaptureTsAbsMs : Date.now();
            const tsMs = wall ? Math.max(0, capAbs - wall) : capAbs;
            await this.serverClient.sendLinks(this._latestLinks, tsMs);
            this._latestLinks = [];
        } catch (_) {}
    };
    this._linksIntervalId = setInterval(tick, 500);
};

MultimediaOrchestrator.prototype._stopLinksForwarding = function () {
    if (this._linksIntervalId) {
        try { clearInterval(this._linksIntervalId); } catch (_) {}
        this._linksIntervalId = null;
    }
    this._latestLinks = [];
    this._latestCaptureTsAbsMs = null;
};
