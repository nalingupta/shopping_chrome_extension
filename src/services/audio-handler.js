import { GeminiLiveAPI } from "./gemini-api.js";
import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { streamingLogger } from "../utils/streaming-logger.js";

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
        this.screenCapture = new ScreenCaptureService();
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
        this.screenCaptureFailureCount = 0;
        this.audioStreamingStarted = false;
        this.isTabSwitching = false; // Flag to prevent multiple simultaneous tab switches
        this.cleanupTimer = null; // Timer for periodic cleanup

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
                this.startEndpointDetection();
            }

            // Send bot response
            if (this.callbacks.botResponse) {
                this.callbacks.botResponse(data);
            }
        }
    }

    handleStreamingUpdate(update) {
        if (update.text) {
            // Finalize user message on first streaming update
            if (
                this.speechBuffer.interimText.trim() &&
                this.callbacks.transcription
            ) {
                const userMessage = this.speechBuffer.interimText.trim();
                this.callbacks.transcription(userMessage);
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
                console.error("Screen capture setup failed:", error);
                throw error;
            }

            // Setup audio capture
            await this.setupAudioCapture();

            // Start media streaming
            await this.startMediaStreaming();

            // Start speech recognition
            this.startLocalSpeechRecognition();

            // Start endpoint detection
            this.startEndpointDetection();

            // Start speech keep-alive
            this.startSpeechKeepAlive();

            // Start periodic cleanup of debugger attachments
            this.startPeriodicCleanup();

            this.state.isListening = true;

            console.log("Listening mode started successfully");

            // Pre-attach to other visible tabs in the background (non-blocking)
            this.screenCapture.preAttachToVisibleTabs().catch((error) => {
                console.warn("Background pre-attachment failed:", error);
            });

            return { success: true };
        } catch (error) {
            console.error("Failed to start listening:", error);
            this.state.isListening = false;
            return { success: false, error: error.message };
        }
    }

    setupTabSwitching() {
        // Store listener references for cleanup
        this.tabListeners = {
            onActivated: async (activeInfo) => {
                const timestamp = new Date().toISOString();
                console.log(
                    `[${timestamp}] 🔄 TAB ACTIVATED: Tab ${activeInfo.tabId} became active`
                );
                console.log(
                    `[${timestamp}] 📊 TAB ACTIVATED: isListening=${
                        this.state.isListening
                    }, hasStream=${this.screenCapture.hasStream()}, isTabSwitching=${
                        this.isTabSwitching
                    }`
                );

                // Enhanced conditions for tab switching
                const shouldSwitch =
                    this.state.isListening &&
                    this.screenCapture.hasStream() &&
                    !this.isTabSwitching;

                if (shouldSwitch) {
                    try {
                        console.log(
                            `[${timestamp}] 🔄 TAB ACTIVATED: Starting tab switch to ${activeInfo.tabId} (Event-driven switch)`
                        );
                        this.isTabSwitching = true;

                        // Get tab info for better logging
                        let tabInfo = { title: "Unknown", url: "Unknown" };
                        try {
                            const tab = await chrome.tabs.get(activeInfo.tabId);
                            tabInfo = {
                                title: tab.title || "Unknown",
                                url: tab.url || "Unknown",
                            };
                        } catch (tabError) {
                            console.log(
                                `[${timestamp}] ⚠️ TAB ACTIVATED: Could not get tab info: ${tabError.message}`
                            );
                        }

                        const result = await this.screenCapture.switchToTab(
                            activeInfo.tabId
                        );

                        if (!result.success) {
                            // Failsafe mechanism: if switching fails, do nothing and continue listening
                            console.warn(
                                `[${timestamp}] ⚠️ FALLBACK: Tab activation switch failed - Tab ID: ${activeInfo.tabId}, Name: "${tabInfo.title}", URL: "${tabInfo.url}", Reason: "Screen capture service rejected tab switch request - ${result.error}. Continuing to capture from current tab."`
                            );
                        } else {
                            console.log(
                                `[${timestamp}] ✅ TAB ACTIVATED: Successfully switched to tab ${activeInfo.tabId} (${tabInfo.title})`
                            );
                        }
                    } catch (error) {
                        // Failsafe mechanism: if switching fails, do nothing and continue listening
                        console.warn(
                            `[${timestamp}] ⚠️ FALLBACK: Tab activation switch failed - Tab ID: ${activeInfo.tabId}, Name: "Unknown", URL: "Unknown", Reason: "Screen capture service rejected tab switch request - ${error.message}. Continuing to capture from current tab."`
                        );
                    } finally {
                        this.isTabSwitching = false;
                        console.log(
                            `[${timestamp}] 🔄 TAB ACTIVATED: Tab switching completed`
                        );
                    }
                } else {
                    // Log specific reason for skipping
                    const reasons = [];
                    if (!this.state.isListening) reasons.push("not listening");
                    if (!this.screenCapture.hasStream())
                        reasons.push("no stream");
                    if (this.isTabSwitching) reasons.push("already switching");

                    console.log(
                        `[${timestamp}] ⏭️ TAB ACTIVATED: Skipping tab switch (${reasons.join(
                            ", "
                        )})`
                    );
                }
            },
            onUpdated: async (tabId, changeInfo, tab) => {
                if (
                    this.state.isListening &&
                    this.screenCapture.getCurrentTabId() === tabId &&
                    changeInfo.status === "complete"
                ) {
                    try {
                        // Check if the new URL is valid for debugger attachment
                        if (
                            tab.url.startsWith("chrome://") ||
                            tab.url.startsWith("chrome-extension://")
                        ) {
                            await this.screenCapture.detachFromTab(tabId);
                        } else {
                            // Re-attach if needed
                            if (!this.screenCapture.attachedTabs.has(tabId)) {
                                await this.screenCapture.setup(tabId);
                            }
                        }
                    } catch (error) {
                        console.error(
                            "Failed to handle tab update:",
                            tabId,
                            error
                        );
                    }
                }
            },
            onRemoved: async (tabId, removeInfo) => {
                // Clean up debugger attachment for the removed tab
                if (this.screenCapture.attachedTabs.has(tabId)) {
                    try {
                        await this.screenCapture.detachFromTab(tabId);
                    } catch (error) {
                        console.error(
                            "Failed to detach from removed tab:",
                            tabId,
                            error
                        );
                    }
                }
            },
            onFocusChanged: async (windowId) => {
                if (this.state.isListening) {
                    try {
                        // Validate all attached tabs when window focus changes
                        await this.screenCapture.validateAttachedTabs();
                    } catch (error) {
                        console.error(
                            "Failed to handle window focus change:",
                            error
                        );
                    }
                }
            },
        };

        // Add listeners
        chrome.tabs.onActivated.addListener(this.tabListeners.onActivated);
        chrome.tabs.onUpdated.addListener(this.tabListeners.onUpdated);
        chrome.tabs.onRemoved.addListener(this.tabListeners.onRemoved);
        chrome.windows.onFocusChanged.addListener(
            this.tabListeners.onFocusChanged
        );
    }

    cleanupTabListeners() {
        if (this.tabListeners) {
            chrome.tabs.onActivated.removeListener(
                this.tabListeners.onActivated
            );
            chrome.tabs.onUpdated.removeListener(this.tabListeners.onUpdated);
            chrome.tabs.onRemoved.removeListener(this.tabListeners.onRemoved);
            chrome.windows.onFocusChanged.removeListener(
                this.tabListeners.onFocusChanged
            );
            this.tabListeners = null;
        }
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

            // Clear timers and stop all streaming FIRST
            this.clearInactivityTimer();
            this.clearSpeechKeepAlive();
            this.stopScreenshotStreaming();
            this.stopPeriodicCleanup(); // Stop periodic cleanup on stop

            // Stop screen capture AFTER stopping streaming
            await this.screenCapture.cleanup();

            // Clean up Chrome extension event listeners
            this.cleanupTabListeners();

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
        if (
            !this.screenCapture.hasStream() ||
            !this.geminiAPI.getConnectionStatus().isConnected
        ) {
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
                    // Log the detach but don't stop listening - let the recovery mechanisms handle tab switches
                    console.log(
                        `[${new Date().toISOString()}] 🔌 DEBUGGER DETACH: Debugger detached during streaming, allowing recovery mechanisms to handle tab switch`
                    );

                    // Don't call stopListening() - let the existing handleDebuggerDetach and onActivated
                    // recovery logic handle the tab switch automatically
                }
            }
        );

        streamingLogger.logInfo("📹 Video stream started (10 FPS)");

        // Capture frames at regular intervals
        this.screenshotInterval = setInterval(async () => {
            const timestamp = new Date().toISOString();

            if (!this.screenCapture.hasStream()) {
                console.log(
                    `[${timestamp}] ⏹️ SCREENSHOT INTERVAL: No stream available, attempting recovery`
                );

                // Try to recover stream before giving up
                const recoverySuccess = await this.recoverFromInvalidTab();
                if (!recoverySuccess) {
                    console.log(
                        `[${timestamp}] ⏹️ SCREENSHOT INTERVAL: Recovery failed, stopping gracefully`
                    );
                    this.stopScreenshotStreaming();
                    return;
                }
            }

            try {
                // Check if we're capturing from the correct active tab
                await this.checkAndSwitchToActiveTab();

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
                    this.geminiAPI.sendVideoFrame(frameData);
                }
            } catch (error) {
                // Check if this is a debugger detachment error (which is expected during tab switches)
                if (
                    error.message &&
                    error.message.includes("Detached while handling command")
                ) {
                    console.log(
                        `[${timestamp}] 🔄 SCREENSHOT INTERVAL: Debugger detached during capture, attempting recovery`
                    );

                    // Try to recover from the detachment instead of stopping
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        console.log(
                            `[${timestamp}] ✅ SCREENSHOT INTERVAL: Recovery successful after debugger detach, continuing capture`
                        );
                        return; // Skip this capture cycle, continue with next
                    } else {
                        console.log(
                            `[${timestamp}] ❌ SCREENSHOT INTERVAL: Recovery failed after debugger detach, stopping capture`
                        );
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                // Retry logic for temporary debugger attachment issues
                if (error.message.includes("Debugger not attached")) {
                    console.log(
                        `[${timestamp}] 🔄 SCREENSHOT INTERVAL: Debugger not attached, skipping this cycle`
                    );
                    return; // Skip this cycle, try again next time
                }

                // Enhanced error recovery for tab-related issues
                if (
                    error.message &&
                    (error.message.includes("no longer exists") ||
                        error.message.includes("not valid for capture") ||
                        error.message.includes("not accessible"))
                ) {
                    console.log(
                        `[${timestamp}] 🔄 SCREENSHOT INTERVAL: Tab validation failed, attempting recovery`
                    );

                    // Try to recover from invalid tab
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        console.log(
                            `[${timestamp}] ✅ SCREENSHOT INTERVAL: Recovery successful, continuing capture`
                        );
                        return; // Skip this capture cycle, continue with next
                    } else {
                        console.log(
                            `[${timestamp}] ❌ SCREENSHOT INTERVAL: Recovery failed, stopping capture`
                        );
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                // For other errors, log details and handle normally
                try {
                    const currentTabId = this.screenCapture.getCurrentTabId();
                    if (currentTabId) {
                        const tab = await chrome.tabs.get(currentTabId);
                        const tabName = tab.title || "Unknown";
                        const tabUrl = tab.url || "Unknown";
                        console.error(
                            `[${timestamp}] ⚠️ FALLBACK: Screenshot interval capture failed - Tab ID: ${currentTabId}, Name: "${tabName}", URL: "${tabUrl}", Reason: "Frame capture failed during periodic screenshot - ${
                                error?.message || error || "Unknown error"
                            }. Stopping screenshot interval to prevent continuous failures."`
                        );
                    } else {
                        console.error(
                            `[${timestamp}] ⚠️ FALLBACK: Screenshot interval capture failed - Tab ID: "None", Name: "Unknown", URL: "Unknown", Reason: "Frame capture failed during periodic screenshot - ${
                                error?.message || error || "Unknown error"
                            }. No current tab available."`
                        );
                    }
                } catch (tabError) {
                    console.error(
                        `[${timestamp}] ⚠️ FALLBACK: Screenshot interval capture failed - Tab ID: "Unknown", Name: "Unknown", URL: "Unknown", Reason: "Frame capture failed during periodic screenshot - ${
                            error?.message || error || "Unknown error"
                        }. Tab info unavailable: ${tabError.message}"`
                    );
                }

                // If frame capture fails consistently, stop listening mode
                this.handleScreenCaptureFailure();
            }
        }, 100); // 10 FPS
    }

    // Recovery method for invalid tab scenarios
    async recoverFromInvalidTab() {
        const timestamp = new Date().toISOString();
        console.log(
            `[${timestamp}] 🔄 RECOVERY: Attempting to recover from invalid tab`
        );

        // Check if a switch is already in progress
        if (this.isTabSwitching) {
            console.log(
                `[${timestamp}] ⏭️ RECOVERY: Switch already in progress, waiting for completion`
            );
            return true; // Assume current switch will succeed
        }

        try {
            // Find current active tab
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!activeTab) {
                console.log(`[${timestamp}] ❌ RECOVERY: No active tab found`);
                return false;
            }

            // Check if active tab is capturable
            if (this.screenCapture.isRestrictedUrl(activeTab.url)) {
                console.log(
                    `[${timestamp}] ❌ RECOVERY: Active tab is restricted (${activeTab.url})`
                );
                return false;
            }

            // Switch to active tab
            const result = await this.screenCapture.switchToTab(activeTab.id);
            if (result.success) {
                console.log(
                    `[${timestamp}] ✅ RECOVERY: Successfully recovered - switched to tab ${activeTab.id} (${activeTab.title})`
                );
                return true;
            } else {
                console.log(
                    `[${timestamp}] ❌ RECOVERY: Failed to switch to active tab: ${result.error}`
                );
                return false;
            }
        } catch (error) {
            console.error(
                `[${timestamp}] ❌ RECOVERY: Error during recovery:`,
                error
            );
            return false;
        }
    }

    // Fallback method to check and switch to the active tab
    async checkAndSwitchToActiveTab() {
        try {
            const timestamp = new Date().toISOString();

            // Get the currently active tab
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!activeTab) {
                console.log(
                    `[${timestamp}] ⚠️ CHECK ACTIVE TAB: No active tab found`
                );
                return;
            }

            const currentTabId = this.screenCapture.getCurrentTabId();
            console.log(
                `[${timestamp}] 📊 CHECK ACTIVE TAB: Current tab: ${currentTabId}, Active tab: ${activeTab.id}`
            );

            // If we're not capturing from the active tab, or if we don't have a stream, log the mismatch
            // but don't switch - let the onActivated event handle tab switching
            if (
                currentTabId !== activeTab.id ||
                !this.screenCapture.hasStream()
            ) {
                console.log(
                    `[${timestamp}] 📊 CHECK ACTIVE TAB: Mismatch detected - Current: ${currentTabId}, Active: ${activeTab.id}`
                );
                console.log(
                    `[${timestamp}] ⏭️ CHECK ACTIVE TAB: Skipping switch (handled by onActivated event)`
                );
                // Don't call switchToTab() - let onActivated handle it
            } else {
                console.log(
                    `[${timestamp}] ✅ CHECK ACTIVE TAB: Already capturing from active tab ${activeTab.id}`
                );
            }
        } catch (error) {
            console.error(
                `[${timestamp}] ❌ CHECK ACTIVE TAB: Error in fallback tab check:`,
                error
            );
            throw error; // Re-throw so caller can handle it
        }
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

        streamingLogger.logInfo("📹 Video stream stopped");
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

        streamingLogger.logInfo("🎤 Audio stream stopped");
    }

    async startAudioStreaming() {
        if (!this.geminiAPI.getConnectionStatus().isConnected) {
            return;
        }

        try {
            // Use AudioWorklet for real-time PCM conversion
            if (this.geminiAPI.audioContext.audioWorklet) {
                await this.startAudioWorkletProcessing();
                streamingLogger.logInfo(
                    "🎤 Audio stream started (AudioWorklet)"
                );
            } else {
                console.warn("AudioWorklet not supported, using fallback");
                this.startScriptProcessorFallback();
                streamingLogger.logInfo(
                    "🎤 Audio stream started (ScriptProcessor)"
                );
            }
        } catch (error) {
            console.error("Audio streaming failed:", error);
            this.startScriptProcessorFallback();
            streamingLogger.logInfo("🎤 Audio stream started (fallback)");
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
        console.log("🎤 startLocalSpeechRecognition() called");
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
                streamingLogger.logInfo(
                    "🎤 Speech detected - starting AUDIO & VIDEO streams"
                );

                // Set flags immediately to prevent race conditions from rapid speech events
                this.audioStreamingStarted = true;
                this.videoStreamingStarted = true;

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
            console.log("🎤 Starting speech recognition...");
            this.speechRecognition.start();
            console.log("🎤 Speech recognition started successfully");
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

        console.log("🔍 Setting inactivity timer for 20 minutes");
        this.inactivityTimer = setTimeout(() => {
            console.log("⏰ Inactivity timer triggered - stopping listening");
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
        streamingLogger.logInfo("Endpoint detection stopped");
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

        streamingLogger.logInfo("Silence detection triggered");
        this.triggerResponseGeneration("silence_detection");
    }

    handleWebSpeechFinalResult() {
        if (!this.endpointDetection.isActive || !this.audioStreamingStarted) {
            return;
        }

        streamingLogger.logInfo("Web Speech API final result");
        this.triggerResponseGeneration("web_speech_final");
    }

    triggerResponseGeneration(source) {
        if (this.speechBuffer.isGeminiProcessing) {
            return;
        }

        streamingLogger.logInfo(`Response generation triggered (${source})`);

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

    startPeriodicCleanup() {
        // Clean up unused debugger attachments every 30 seconds
        this.cleanupTimer = setInterval(async () => {
            if (this.state.isListening) {
                try {
                    // First validate all attached tabs
                    await this.screenCapture.validateAttachedTabs();

                    // Then do regular cleanup
                    await this.screenCapture.cleanupUnusedAttachments();
                } catch (error) {
                    console.error("Error during periodic cleanup:", error);
                }
            }
        }, 30000); // 30 seconds
    }

    stopPeriodicCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}
