import { GeminiLiveAPI } from "./gemini-api.js";
import { DebuggerScreenCapture } from "./debugger-screen-capture.js";
import { LivePreviewManager } from "./live-preview-manager.js";

export class AudioHandler {
    constructor() {
        this.state = {
            isListening: false,
            isProcessingResponse: false,
        };

        this.callbacks = {
            transcription: null,
            interim: null,
            botResponse: null,
            status: null,
            listeningStopped: null,
        };

        // Gemini-first speech segmentation
        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
            isGeminiProcessing: false,
        };

        // Hybrid endpoint detection system
        this.endpointDetection = {
            isActive: false,
            lastSpeechTime: null,
            silenceThreshold: 2000, // 2 seconds of silence as fallback
            audioLevelThreshold: 0.01, // Minimum audio level to consider as speech
            silenceTimer: null,
            audioLevelHistory: [], // Track recent audio levels
            audioLevelWindow: 10, // Number of samples to average
            responseTimeout: null, // Timeout for Gemini response
            responseTimeoutDuration: 10000, // 10 seconds timeout
        };

        this.geminiAPI = new GeminiLiveAPI();
        this.screenCapture = new DebuggerScreenCapture();
        this.previewManager = new LivePreviewManager();
        this.speechRecognition = null;
        this.audioStream = null;
        this.audioWorkletNode = null;
        this.audioSource = null;
        this.inactivityTimer = null;
        this.speechKeepAliveTimer = null;
        this.lastSpeechActivity = null;
        this.videoStreamingStarted = false;
        this.screenshotInterval = null;
        this.audioStreamingStarted = false;
        this.screenCaptureFailureCount = 0;

        this.setupGeminiCallbacks();
        this.initializeGemini();
    }

    async initializeGemini() {
        try {
            const result = await this.geminiAPI.initialize();
            if (!result.success) {
                console.error("Gemini initialization failed:", result.error);
            }
        } catch (error) {
            console.error("Error initializing Gemini:", error);
        }
    }

    setupGeminiCallbacks() {
        this.geminiAPI.setBotResponseCallback((data) => {
            this.handleGeminiResponse(data);
        });

        this.geminiAPI.setStreamingUpdateCallback((update) => {
            this.handleStreamingUpdate(update);
        });

        this.geminiAPI.setConnectionStateCallback((state) => {
            if (this.callbacks.status) {
                if (state === "connected") {
                    this.callbacks.status(
                        "Connected to Gemini",
                        "success",
                        2000
                    );
                } else if (state === "disconnected") {
                    this.callbacks.status("Disconnected", "error", 3000);
                }
            }
        });

        this.geminiAPI.setErrorCallback((error) => {
            console.error("Gemini error:", error);
            if (this.callbacks.status) {
                this.callbacks.status("Connection error", "error", 3000);
            }
        });
    }

    handleGeminiResponse(data) {
        if (data.text) {
            console.log(
                "✅ Gemini response received - resetting for next speech input"
            );

            // Clear response timeout since we got a response
            this.clearResponseTimeout();

            // Gemini has processed a complete utterance
            this.speechBuffer.isGeminiProcessing = false;

            // Clear interim text since Gemini has processed it
            this.speechBuffer.interimText = "";

            // Reset streaming flags for next speech detection
            this.audioStreamingStarted = false;
            this.videoStreamingStarted = false;

            // Restart endpoint detection for next speech input
            if (this.state.isListening && this.endpointDetection.isActive) {
                console.log(
                    "🔄 Restarting endpoint detection for next speech input"
                );
                this.startEndpointDetection();
            }

            // Send bot response
            if (this.callbacks.botResponse) {
                this.callbacks.botResponse(data);
            }
        }
    }

    handleStreamingUpdate(update) {
        console.log("handleStreamingUpdate called with:", update);

        if (update.text) {
            // Finalize user message on first streaming update
            if (
                this.speechBuffer.interimText.trim() &&
                this.callbacks.transcription
            ) {
                this.callbacks.transcription(
                    this.speechBuffer.interimText.trim()
                );
                this.speechBuffer.interimText = "";
            }

            // Send streaming update to UI
            if (this.callbacks.botResponse) {
                this.callbacks.botResponse({
                    text: update.text,
                    isStreaming: true,
                    timestamp: update.timestamp,
                });
            }
        }
    }

    // Fallback method to handle orphaned interim text
    checkForOrphanedSpeech() {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.speechBuffer.lastWebSpeechUpdate;

        // If we have interim text that hasn't been processed by Gemini for 3 seconds, create a message
        if (
            this.speechBuffer.interimText.trim() &&
            !this.speechBuffer.isGeminiProcessing &&
            timeSinceLastUpdate > 3000
        ) {
            console.log(
                "Processing orphaned speech:",
                this.speechBuffer.interimText
            );

            if (this.callbacks.transcription) {
                this.callbacks.transcription(
                    this.speechBuffer.interimText.trim()
                );
            }

            this.speechBuffer.interimText = "";
        }
    }

    async startListening() {
        if (this.state.isListening) {
            return { success: false, error: "Already listening" };
        }

        try {
            this.resetInactivityTimer();

            // Connect to Gemini
            const result = await this.geminiAPI.connect();
            if (!result.success) {
                throw new Error(result.error || "Failed to connect to Gemini");
            }

            // Setup screen capture
            try {
                console.log("Setting up screen capture...");
                const tabs = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });
                if (tabs.length > 0) {
                    const setupResult = await this.screenCapture.setup(
                        tabs[0].id
                    );
                    if (!setupResult.success) {
                        throw new Error(
                            setupResult.error ||
                                "Failed to setup screen capture"
                        );
                    }
                } else {
                    throw new Error("No active tab found");
                }

                // Set up tab switching listener
                this.setupTabSwitching();

                // Start continuous screen capture immediately
                this.startScreenshotStreaming();
            } catch (error) {
                console.error("Screen capture setup failed:", error.message);
                // Stop listening mode if screen capture fails
                await this.stopListening();

                // Notify UI that listening stopped due to setup failure
                if (this.callbacks.listeningStopped) {
                    this.callbacks.listeningStopped("setup_failed");
                }

                return {
                    success: false,
                    error: "Screen capture is required for this assistant. Please allow debugger access and try again.",
                };
            }

            // Setup audio capture
            await this.setupAudioCapture();

            // Start media streaming
            await this.startMediaStreaming();

            // Start local speech recognition for UI feedback
            this.startLocalSpeechRecognition();
            this.startSpeechKeepAlive();

            this.state.isListening = true;
            return { success: true };
        } catch (error) {
            console.error("Error starting listening:", error);
            return { success: false, error: error.message };
        }
    }

    setupTabSwitching() {
        // Listen for tab activation changes
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
            if (this.state.isListening && this.screenCapture.hasStream()) {
                try {
                    console.log("Tab switched to:", activeInfo.tabId);
                    await this.screenCapture.switchToTab(activeInfo.tabId);
                } catch (error) {
                    console.error(
                        "Failed to switch to tab:",
                        activeInfo.tabId,
                        error
                    );
                }
            }
        });

        // Listen for tab updates (URL changes)
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (
                this.state.isListening &&
                this.screenCapture.getCurrentTabId() === tabId &&
                changeInfo.status === "complete"
            ) {
                try {
                    console.log("Tab updated:", tabId, "URL:", tab.url);
                    // Re-attach if needed
                    if (!this.screenCapture.attachedTabs.has(tabId)) {
                        await this.screenCapture.setup(tabId);
                    }
                } catch (error) {
                    console.error("Failed to handle tab update:", tabId, error);
                }
            }
        });

        // Listen for tab removal
        chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
            console.log("Tab removed:", tabId);
            // The debugger will automatically detach, but we can clean up our tracking
        });
    }

    async handleScreenCaptureFailure() {
        this.screenCaptureFailureCount++;

        // If we have multiple consecutive failures, stop listening mode
        if (this.screenCaptureFailureCount >= 3) {
            console.error(
                "Multiple screen capture failures detected, stopping listening mode"
            );

            if (this.callbacks.status) {
                this.callbacks.status(
                    "Screen capture failed - stopping listening mode",
                    "error",
                    5000
                );
            }

            await this.stopListening();

            // Notify UI that listening stopped due to screen capture failure
            if (this.callbacks.listeningStopped) {
                this.callbacks.listeningStopped("screen_capture_failed");
            }
        }
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: "Not currently listening" };
        }

        try {
            this.state.isListening = false;

            // Process any remaining interim text before stopping
            if (
                this.speechBuffer.interimText.trim() &&
                this.callbacks.transcription
            ) {
                console.log(
                    "Processing final interim text on stop:",
                    this.speechBuffer.interimText
                );
                this.callbacks.transcription(
                    this.speechBuffer.interimText.trim()
                );
            }

            // Clear speech buffer
            this.speechBuffer = {
                interimText: "",
                lastWebSpeechUpdate: 0,
                isGeminiProcessing: false,
            };

            // Stop endpoint detection
            this.stopEndpointDetection();

            // Stop local speech recognition
            if (this.speechRecognition) {
                try {
                    this.speechRecognition.stop();
                } catch (err) {
                    console.warn("Error stopping speech recognition:", err);
                }
                this.speechRecognition = null;
            }

            // Stop audio processing
            this.stopAudioProcessing();

            // Stop Gemini streaming
            await this.geminiAPI.disconnect();

            // Stop screen capture
            await this.screenCapture.cleanup();

            // Clear timers and stop all streaming
            this.clearInactivityTimer();
            this.clearSpeechKeepAlive();
            this.stopScreenshotStreaming();

            // Reset streaming flags for next session
            this.videoStreamingStarted = false;
            this.audioStreamingStarted = false;

            return { success: true };
        } catch (error) {
            console.error("Error stopping listening:", error);
            this.state.isListening = false;
            return { success: false, error: error.message };
        }
    }

    async setupAudioCapture() {
        try {
            // Get microphone audio
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    // More aggressive echo cancellation
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true,
                },
            });

            return true;
        } catch (error) {
            console.error("Audio capture setup failed:", error);
            throw error;
        }
    }

    async startMediaStreaming() {
        // Wait for Gemini setup to complete
        let waitCount = 0;
        while (
            !this.geminiAPI.getConnectionStatus().isSetupComplete &&
            waitCount < 50
        ) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            waitCount++;
        }

        if (!this.geminiAPI.getConnectionStatus().isSetupComplete) {
            throw new Error("Gemini setup did not complete in time");
        }

        // Don't start video or audio streaming yet - wait for first speech detection
        this.videoStreamingStarted = false;
        this.audioStreamingStarted = false;
    }

    startScreenshotStreaming() {
        console.log("Starting screenshot streaming...");
        console.log(
            "Screen capture has stream:",
            this.screenCapture.hasStream()
        );
        console.log(
            "Gemini connected:",
            this.geminiAPI.getConnectionStatus().isConnected
        );

        if (
            !this.screenCapture.hasStream() ||
            !this.geminiAPI.getConnectionStatus().isConnected
        ) {
            console.log(
                "Screenshot streaming skipped - screenActive:",
                this.screenCapture.hasStream(),
                "geminiConnected:",
                this.geminiAPI.getConnectionStatus().isConnected
            );
            return;
        }

        // Start live preview
        this.previewManager.startPreview();

        // Start recording (just sets up the debugger connection)
        this.screenCapture.startRecording(
            (frameData) => {
                // This callback won't be used since we're using interval-based capture
            },
            (error) => {
                console.error(
                    "Debugger screen capture error:",
                    error?.message || error || "Unknown error"
                );

                // Handle debugger detach events
                if (error && error.type === "debugger_detached") {
                    console.error("Debugger detached:", error.reason);

                    // Immediately stop listening mode when debugger is detached
                    if (this.callbacks.status) {
                        this.callbacks.status(
                            "Screen capture cancelled - stopping listening mode",
                            "error",
                            5000
                        );
                    }

                    // Use setTimeout to avoid async issues in callback
                    setTimeout(async () => {
                        await this.stopListening();

                        // Notify UI that listening stopped due to debugger detach
                        if (this.callbacks.listeningStopped) {
                            this.callbacks.listeningStopped(
                                "debugger_detached"
                            );
                        }
                    }, 0);
                }
            }
        );

        // Capture frames at regular intervals
        console.log("Setting up screenshot interval (10 FPS)...");
        this.screenshotInterval = setInterval(async () => {
            if (!this.screenCapture.hasStream()) {
                console.log(
                    "Screenshot interval check failed - screenActive:",
                    this.screenCapture.hasStream()
                );
                this.stopScreenshotStreaming();
                return;
            }

            try {
                console.log(
                    "Screenshot interval triggered - capturing frame..."
                );
                const frameData = await this.screenCapture.captureFrame();

                // Reset failure counter on successful capture
                this.screenCaptureFailureCount = 0;

                // Always update live preview
                this.previewManager.updatePreview(frameData);

                // Only send to Gemini if we're streaming and connected
                if (
                    this.videoStreamingStarted &&
                    this.geminiAPI.getConnectionStatus().isConnected
                ) {
                    console.log(
                        "Sending frame to Gemini, size:",
                        Math.round(frameData.length * 0.75),
                        "bytes"
                    );
                    console.log(
                        "Video streaming started:",
                        this.videoStreamingStarted,
                        "Gemini connected:",
                        this.geminiAPI.getConnectionStatus().isConnected
                    );
                    this.geminiAPI.sendVideoFrame(frameData);
                } else {
                    console.log(
                        "Frame captured but not sent to Gemini - videoStreamingStarted:",
                        this.videoStreamingStarted,
                        "geminiConnected:",
                        this.geminiAPI.getConnectionStatus().isConnected
                    );
                }
            } catch (error) {
                console.error(
                    "Frame capture failed:",
                    error?.message || error || "Unknown error"
                );

                // If frame capture fails consistently, stop listening mode
                this.handleScreenCaptureFailure();
            }
        }, 100); // 10 FPS
    }

    stopScreenshotStreaming() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }

        // Stop debugger recording
        if (this.screenCapture.isActive()) {
            this.screenCapture.stopRecording();
        }

        // Stop live preview
        this.previewManager.stopPreview();

        console.log("Screenshot streaming stopped");
    }

    stopAudioStreaming() {
        if (this.audioWorkletNode) {
            this.audioWorkletNode.disconnect();
            this.audioWorkletNode = null;
        }

        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }

        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }

        console.log("Audio streaming to Gemini stopped");
    }

    async startAudioStreaming() {
        if (!this.geminiAPI.getConnectionStatus().isConnected) {
            return;
        }

        try {
            // Use AudioWorklet for real-time PCM conversion
            if (this.geminiAPI.audioContext.audioWorklet) {
                await this.startAudioWorkletProcessing();
            } else {
                console.warn("AudioWorklet not supported, using fallback");
                this.startScriptProcessorFallback();
            }
        } catch (error) {
            console.error("Audio streaming failed:", error);
            this.startScriptProcessorFallback();
        }
    }

    async startAudioWorkletProcessing() {
        const processorUrl = chrome.runtime.getURL(
            "src/audio/pcm-processor.js"
        );
        await this.geminiAPI.audioContext.audioWorklet.addModule(processorUrl);

        this.audioWorkletNode = new AudioWorkletNode(
            this.geminiAPI.audioContext,
            "pcm-processor"
        );

        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, pcmData, maxAmplitude } = event.data;

            if (
                type === "audioData" &&
                this.geminiAPI.getConnectionStatus().isConnected
            ) {
                const uint8Array = new Uint8Array(pcmData.buffer);
                const base64 = btoa(String.fromCharCode(...uint8Array));
                this.geminiAPI.sendAudioChunk(base64);

                // Send audio level for endpoint detection (tertiary fallback)
                if (maxAmplitude !== undefined) {
                    this.onAudioLevelDetected(maxAmplitude);
                }
            }
        };

        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(
            this.audioStream
        );
        this.audioSource.connect(this.audioWorkletNode);
        // DO NOT connect to destination to avoid feedback loop
    }

    startScriptProcessorFallback() {
        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(
            this.audioStream
        );
        this.audioProcessor = this.geminiAPI.audioContext.createScriptProcessor(
            4096,
            1,
            1
        );

        this.audioProcessor.onaudioprocess = (event) => {
            if (!this.geminiAPI.getConnectionStatus().isConnected) return;

            const inputData = event.inputBuffer.getChannelData(0);
            const outputData = event.outputBuffer.getChannelData(0);

            // Copy input to output
            for (let i = 0; i < inputData.length; i++) {
                outputData[i] = inputData[i];
            }

            // Calculate max amplitude for audio level detection
            let maxAmplitude = 0;
            for (let i = 0; i < inputData.length; i++) {
                const amplitude = Math.abs(inputData[i]);
                maxAmplitude = Math.max(maxAmplitude, amplitude);
            }

            // Send audio level for endpoint detection (tertiary fallback)
            this.onAudioLevelDetected(maxAmplitude);

            // Convert to PCM and send to Gemini
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const sample = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            }

            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            this.geminiAPI.sendAudioChunk(base64);
        };

        this.audioSource.connect(this.audioProcessor);
        // DO NOT connect to destination to avoid feedback loop
    }

    stopAudioProcessing() {
        // Stop streaming to Gemini
        this.stopAudioStreaming();

        // Stop the actual microphone stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach((track) => track.stop());
            this.audioStream = null;
        }
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

        this.speechRecognition.onresult = async (event) => {
            this.resetInactivityTimer();
            this.lastSpeechActivity = Date.now();

            // Start audio streaming on first speech detection
            if (!this.audioStreamingStarted) {
                console.log(
                    "🎤 First speech detected - starting audio streaming to Gemini"
                );

                // Set flags immediately to prevent race conditions from rapid speech events
                this.audioStreamingStarted = true;
                this.videoStreamingStarted = true;
                console.log("Audio and video streaming flags set to true");

                // Start audio streaming to Gemini
                await this.startAudioStreaming();

                // Start endpoint detection
                this.startEndpointDetection();
            }

            // Signal that speech is detected for endpoint detection
            this.onSpeechDetected();

            // Only process the latest result to avoid accumulating old speech
            let latestTranscript = "";
            let hasInterimResults = false;
            let hasFinalResults = false;

            // Get only the most recent result (not all accumulated results)
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

            // Update speech buffer with only the latest transcript segment
            this.speechBuffer.interimText = latestTranscript;
            this.speechBuffer.lastWebSpeechUpdate = Date.now();

            // Show only the latest interim text in UI
            if (hasInterimResults && this.callbacks.interim) {
                this.callbacks.interim(latestTranscript);
            }

            // Handle final results from Web Speech API (primary endpoint detection)
            if (hasFinalResults) {
                console.log(
                    "🎯 Web Speech API detected final result:",
                    latestTranscript
                );
                this.handleWebSpeechFinalResult();
            }

            // NOTE: Final transcriptions are now handled by Gemini responses only
            // We don't create message bubbles from Web Speech API anymore
        };

        this.speechRecognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);

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

                if (timeSinceLastActivity < 30000) {
                    setTimeout(() => {
                        if (this.state.isListening) {
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

            // Check for orphaned speech every cycle
            this.checkForOrphanedSpeech();

            const now = Date.now();
            const timeSinceLastActivity =
                now - (this.lastSpeechActivity || now);

            if (timeSinceLastActivity > 30000) {
                this.restartSpeechRecognition();
            }
        }, 5000); // Check more frequently (every 5 seconds)
    }

    clearSpeechKeepAlive() {
        if (this.speechKeepAliveTimer) {
            clearInterval(this.speechKeepAliveTimer);
            this.speechKeepAliveTimer = null;
        }
    }

    resetInactivityTimer() {
        this.clearInactivityTimer();

        this.inactivityTimer = setTimeout(() => {
            this.stopListening();
            if (this.callbacks.status) {
                this.callbacks.status("Session timed out", "warning", 5000);
            }
        }, 20 * 60 * 1000); // 20 minutes
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    // Hybrid endpoint detection methods
    startEndpointDetection() {
        this.endpointDetection.isActive = true;
        this.endpointDetection.lastSpeechTime = Date.now();
        this.resetSilenceTimer();
        console.log("Endpoint detection started");
    }

    stopEndpointDetection() {
        this.endpointDetection.isActive = false;
        this.clearSilenceTimer();
        this.clearResponseTimeout();
        this.endpointDetection.audioLevelHistory = [];
        console.log("Endpoint detection stopped");
    }

    resetSilenceTimer() {
        this.clearSilenceTimer();

        this.endpointDetection.silenceTimer = setTimeout(() => {
            this.handleSilenceDetected();
        }, this.endpointDetection.silenceThreshold);
    }

    clearSilenceTimer() {
        if (this.endpointDetection.silenceTimer) {
            clearTimeout(this.endpointDetection.silenceTimer);
            this.endpointDetection.silenceTimer = null;
        }
    }

    onSpeechDetected() {
        this.endpointDetection.lastSpeechTime = Date.now();
        this.resetSilenceTimer();
    }

    onAudioLevelDetected(level) {
        if (!this.endpointDetection.isActive) return;

        // Add to history and maintain window size
        this.endpointDetection.audioLevelHistory.push(level);
        if (
            this.endpointDetection.audioLevelHistory.length >
            this.endpointDetection.audioLevelWindow
        ) {
            this.endpointDetection.audioLevelHistory.shift();
        }

        // Check if audio level indicates speech activity
        const averageLevel =
            this.endpointDetection.audioLevelHistory.reduce(
                (a, b) => a + b,
                0
            ) / this.endpointDetection.audioLevelHistory.length;

        if (averageLevel > this.endpointDetection.audioLevelThreshold) {
            this.onSpeechDetected();
        }
    }

    handleSilenceDetected() {
        if (!this.endpointDetection.isActive || !this.audioStreamingStarted) {
            return;
        }

        console.log(
            "Silence detection triggered - fallback endpoint detection"
        );
        this.triggerResponseGeneration("silence_detection");
    }

    handleWebSpeechFinalResult() {
        if (!this.endpointDetection.isActive || !this.audioStreamingStarted) {
            return;
        }

        console.log("Web Speech API final result - primary endpoint detection");
        this.triggerResponseGeneration("web_speech_final");
    }

    triggerResponseGeneration(source) {
        if (this.speechBuffer.isGeminiProcessing) {
            console.log(
                "Already processing response, ignoring endpoint detection from:",
                source
            );
            return;
        }

        console.log("🎯 TRIGGERING RESPONSE GENERATION from:", source);
        console.log(
            "   - Audio streaming started:",
            this.audioStreamingStarted
        );
        console.log(
            "   - Endpoint detection active:",
            this.endpointDetection.isActive
        );
        console.log(
            "   - Speech buffer interim text:",
            this.speechBuffer.interimText
        );

        // Mark that we're waiting for Gemini to process
        this.speechBuffer.isGeminiProcessing = true;

        // DON'T stop audio streaming or send signals - let Gemini handle speech endpoint detection
        // The audio should continue flowing to Gemini so it can properly detect when speech ends
        console.log("🔄 Waiting for Gemini to process speech naturally...");

        // Set a timeout in case Gemini doesn't respond
        this.setResponseTimeout();

        // Update UI to show processing state
        if (this.callbacks.status) {
            this.callbacks.status("Processing speech...", "info");
        }

        // Reset streaming flags for next speech detection
        this.audioStreamingStarted = false;
        this.videoStreamingStarted = false;
    }

    setResponseTimeout() {
        this.clearResponseTimeout();

        this.endpointDetection.responseTimeout = setTimeout(() => {
            console.log("⏰ Response timeout - resetting system");
            this.handleResponseTimeout();
        }, this.endpointDetection.responseTimeoutDuration);
    }

    clearResponseTimeout() {
        if (this.endpointDetection.responseTimeout) {
            clearTimeout(this.endpointDetection.responseTimeout);
            this.endpointDetection.responseTimeout = null;
        }
    }

    handleResponseTimeout() {
        console.log("🔄 Response timeout - resetting for next speech input");

        // Reset processing state
        this.speechBuffer.isGeminiProcessing = false;
        this.speechBuffer.interimText = "";

        // Reset streaming flags
        this.audioStreamingStarted = false;
        this.videoStreamingStarted = false;

        // Restart endpoint detection
        if (this.state.isListening && this.endpointDetection.isActive) {
            this.startEndpointDetection();
        }

        // Update UI
        if (this.callbacks.status) {
            this.callbacks.status("Ready for next input", "info");
        }
    }

    // Manual method to force response generation (for debugging/testing)
    forceResponseGeneration() {
        console.log("🔧 Manually forcing response generation");
        this.triggerResponseGeneration("manual_trigger");
    }

    // Callback setters
    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    setBotResponseCallback(callback) {
        this.callbacks.botResponse = callback;
    }

    setStatusCallback(callback) {
        this.callbacks.status = callback;
    }

    setListeningStoppedCallback(callback) {
        this.callbacks.listeningStopped = callback;
    }

    // Getters
    isListening() {
        return this.state.isListening;
    }

    isProcessingResponse() {
        return this.state.isProcessingResponse;
    }
}
