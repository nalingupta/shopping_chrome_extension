import { GeminiLiveAPI } from "./gemini-api.js";
import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { AudioCaptureService } from "./audio/audio-capture-service.js";
import { SpeechRecognitionService } from "./audio/speech-recognition-service.js";
import { EndpointDetectionService } from "./audio/endpoint-detection-service.js";
import { AudioStateManager } from "./audio/audio-state-manager.js";
import { streamingLogger } from "../utils/streaming-logger.js";

export class AudioHandler {
    constructor() {
        // Gemini-first speech segmentation
        this.speechBuffer = {
            interimText: "",
            lastWebSpeechUpdate: 0,
            isGeminiProcessing: false,
        };

        this.geminiAPI = new GeminiLiveAPI();
        this.screenCapture = new ScreenCaptureService();
        this.previewManager = new LivePreviewManager();
        this.audioCapture = new AudioCaptureService(this.geminiAPI);
        this.speechRecognition = new SpeechRecognitionService();
        this.endpointDetection = new EndpointDetectionService();
        this.stateManager = new AudioStateManager();
        this.videoStreamingStarted = false;
        this.screenshotInterval = null;
        this.screenCaptureFailureCount = 0;
        this.audioStreamingStarted = false;
        this.isTabSwitching = false; // Flag to prevent multiple simultaneous tab switches
        this.cleanupTimer = null; // Timer for periodic cleanup

        this.setupGeminiCallbacks();
        this.initializeGemini();

        // Set up audio level callback
        this.audioCapture.setAudioLevelCallback((level) => {
            this.onAudioLevelDetected(level);
        });

        // Set up speech recognition callbacks
        this.speechRecognition.setCallbacks({
            onSpeechDetected: () => this.onSpeechDetected(),
            onInterimResult: (text) => {
                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.interim) {
                    callbacks.interim(text);
                }
            },
            onAudioStreamingStart: async () => {
                await this.startAudioStreaming();
                this.audioStreamingStarted = true;
            },
            onVideoStreamingStart: () => {
                this.videoStreamingStarted = true;
            },
            onEndpointDetectionStart: () => this.startEndpointDetection(),
            onWebSpeechFinalResult: () => this.handleWebSpeechFinalResult(),
            onCheckOrphanedSpeech: () => this.checkForOrphanedSpeech(),
        });

        // Set up endpoint detection callbacks
        this.endpointDetection.setCallbacks({
            onSilenceDetected: () => this.handleSilenceDetected(),
            onResponseTimeout: () => {
                // Handle response timeout without calling handleResponseTimeout again
                this.audioStreamingStarted = false;
                this.videoStreamingStarted = false;
                // Any other cleanup needed
            },
            onResponseGeneration: (source) => {
                this.audioStreamingStarted = false;
                this.videoStreamingStarted = false;
            },
            onStatus: (status, type, duration) => {
                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.status) {
                    callbacks.status(status, type, duration);
                }
            },
            onEndpointDetectionStart: () => this.startEndpointDetection(),
        });
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
            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.status) {
                if (state === "connected") {
                    callbacks.status("Connected to Gemini", "success", 2000);
                } else if (state === "disconnected") {
                    callbacks.status("Disconnected", "error", 3000);
                }
            }
        });

        this.geminiAPI.setErrorCallback((error) => {
            console.error("Gemini error:", error);
            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.status) {
                callbacks.status("Connection error", "error", 3000);
            }
        });
    }

    handleGeminiResponse(data) {
        if (data.text) {
            this.clearResponseTimeout();
            this.speechBuffer.isGeminiProcessing = false;
            this.speechBuffer.interimText = "";
            this.audioStreamingStarted = false;
            this.videoStreamingStarted = false;

            if (
                this.stateManager.isListening() &&
                this.endpointDetection.isActive
            ) {
                this.startEndpointDetection();
            }

            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.botResponse) {
                callbacks.botResponse(data);
            }
        }
    }

    handleStreamingUpdate(update) {
        if (update.text) {
            const callbacks = this.stateManager.getCallbacks();
            if (
                this.speechBuffer.interimText.trim() &&
                callbacks.transcription
            ) {
                const userMessage = this.speechBuffer.interimText.trim();
                callbacks.transcription(userMessage);
                this.speechBuffer.interimText = "";
            }

            if (callbacks.botResponse) {
                callbacks.botResponse({
                    text: update.text,
                    isStreaming: true,
                    timestamp: update.timestamp,
                });
            }
        }
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

    async startListening() {
        if (this.stateManager.isListening()) {
            return { success: false, error: "Already listening" };
        }

        try {
            this.resetInactivityTimer();

            const result = await this.geminiAPI.connect();
            if (!result.success) {
                throw new Error(result.error || "Failed to connect to Gemini");
            }

            try {
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

                this.setupTabSwitching();
                this.startScreenshotStreaming();
            } catch (error) {
                console.error("Screen capture setup failed:", error);
                throw error;
            }

            await this.setupAudioCapture();
            await this.startMediaStreaming();
            this.startLocalSpeechRecognition();
            this.startEndpointDetection();
            this.startSpeechKeepAlive();
            this.startPeriodicCleanup();

            this.stateManager.setListeningState(true);

            this.screenCapture.preAttachToVisibleTabs().catch((error) => {
                console.warn("Background pre-attachment failed:", error);
            });

            return { success: true };
        } catch (error) {
            console.error("Failed to start listening:", error);
            this.stateManager.setListeningState(false);
            return { success: false, error: error.message };
        }
    }

    setupTabSwitching() {
        this.tabListeners = {
            onActivated: async (activeInfo) => {
                const shouldSwitch =
                    this.stateManager.isListening() && !this.isTabSwitching;

                if (shouldSwitch) {
                    try {
                        this.isTabSwitching = true;
                        const result = await this.screenCapture.switchToTab(
                            activeInfo.tabId
                        );

                        if (!result.success) {
                            const failureType =
                                this.screenCapture.categorizeFailure(
                                    result.error,
                                    activeInfo.tabId
                                );
                            await this.handleTabSwitchFailure(
                                activeInfo.tabId,
                                failureType,
                                result.error
                            );
                        }
                    } catch (error) {
                        console.warn("Tab activation switch failed:", error);
                    } finally {
                        this.isTabSwitching = false;
                    }
                }
            },
            onUpdated: async (tabId, changeInfo, tab) => {
                if (
                    this.stateManager.isListening() &&
                    changeInfo.status === "complete"
                ) {
                    try {
                        const isCurrentTab =
                            this.screenCapture.getCurrentTabId() === tabId;
                        const isMonitored =
                            this.screenCapture.monitoredTabs.has(tabId);

                        if (isCurrentTab) {
                            if (
                                tab.url.startsWith("chrome://") ||
                                tab.url.startsWith("chrome-extension://")
                            ) {
                                await this.screenCapture.detachFromTab(tabId);
                            } else {
                                if (
                                    !this.screenCapture.attachedTabs.has(tabId)
                                ) {
                                    await this.screenCapture.setup(tabId);
                                }
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

                if (this.screenCapture.monitoredTabs.has(tabId)) {
                    this.screenCapture.stopUrlMonitoring(tabId);
                }
            },
            onCreated: async (tab) => {
                if (tab.active && this.stateManager.isListening()) {
                    // Will be handled by onActivated listener
                }
            },
            onFocusChanged: async (windowId) => {
                if (this.stateManager.isListening()) {
                    try {
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

        chrome.tabs.onActivated.addListener(this.tabListeners.onActivated);
        chrome.tabs.onUpdated.addListener(this.tabListeners.onUpdated);
        chrome.tabs.onRemoved.addListener(this.tabListeners.onRemoved);
        chrome.tabs.onCreated.addListener(this.tabListeners.onCreated);
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
            chrome.tabs.onCreated.removeListener(this.tabListeners.onCreated);
            chrome.windows.onFocusChanged.removeListener(
                this.tabListeners.onFocusChanged
            );
            this.tabListeners = null;
        }
    }

    async handleScreenCaptureFailure() {
        this.screenCaptureFailureCount++;

        if (this.screenCaptureFailureCount >= 3) {
            console.error(
                "Multiple screen capture failures detected, stopping listening mode"
            );

            const callbacks = this.stateManager.getCallbacks();
            if (callbacks.status) {
                callbacks.status(
                    "Screen capture failed - stopping listening mode",
                    "error",
                    5000
                );
            }

            await this.stopListening();

            if (callbacks.listeningStopped) {
                callbacks.listeningStopped("screen_capture_failed");
            }
        }
    }

    async handleTabSwitchFailure(tabId, failureType, error) {
        const criticalFailureTypes = [
            "NETWORK_ERROR",
            "PERMISSION_DENIED",
            "UNKNOWN_ERROR",
        ];

        if (criticalFailureTypes.includes(failureType)) {
            this.screenCaptureFailureCount++;

            if (this.screenCaptureFailureCount >= 3) {
                console.error(
                    "Multiple critical failures detected, stopping listening mode"
                );

                const callbacks = this.stateManager.getCallbacks();
                if (callbacks.status) {
                    callbacks.status(
                        "Critical failures detected - stopping listening mode",
                        "error",
                        5000
                    );
                }

                await this.stopListening();

                if (callbacks.listeningStopped) {
                    callbacks.listeningStopped("critical_failures");
                }
            }
        }
    }

    async stopListening() {
        if (!this.stateManager.isListening()) {
            return { success: false, error: "Not currently listening" };
        }

        try {
            this.stateManager.setListeningState(false);

            if (
                this.speechBuffer.interimText.trim() &&
                this.callbacks.transcription
            ) {
                this.callbacks.transcription(
                    this.speechBuffer.interimText.trim()
                );
            }

            this.speechBuffer = {
                interimText: "",
                lastWebSpeechUpdate: 0,
                isGeminiProcessing: false,
            };

            this.stopEndpointDetection();

            if (this.speechRecognition) {
                this.speechRecognition.stopSpeechRecognition();
            }

            this.stopAudioProcessing();
            await this.geminiAPI.disconnect();

            this.clearInactivityTimer();
            this.clearSpeechKeepAlive();
            this.stopScreenshotStreaming();
            this.stopPeriodicCleanup();

            await this.screenCapture.cleanup();
            this.cleanupTabListeners();

            this.videoStreamingStarted = false;
            this.audioStreamingStarted = false;

            return { success: true };
        } catch (error) {
            console.error("Error stopping listening:", error);
            this.stateManager.setListeningState(false);
            return { success: false, error: error.message };
        }
    }

    async setupAudioCapture() {
        return this.audioCapture.setupAudioCapture();
    }

    async startMediaStreaming() {
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

        this.previewManager.startPreview();
        this.screenCapture.startRecording();
        streamingLogger.logInfo("📹 Video stream started (10 FPS)");

        this.screenshotInterval = setInterval(async () => {
            if (!this.screenCapture.hasStream()) {
                const recoverySuccess = await this.recoverFromInvalidTab();
                if (!recoverySuccess) {
                    this.stopScreenshotStreaming();
                    return;
                }
            }

            try {
                await this.checkAndSwitchToActiveTab();
                const frameData = await this.screenCapture.captureFrame();
                this.screenCaptureFailureCount = 0;
                this.previewManager.updatePreview(frameData);

                if (
                    this.videoStreamingStarted &&
                    this.geminiAPI.getConnectionStatus().isConnected
                ) {
                    this.geminiAPI.sendVideoFrame(frameData);
                }
            } catch (error) {
                if (
                    error.message &&
                    error.message.includes("Detached while handling command")
                ) {
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                if (error.message.includes("Debugger not attached")) {
                    return;
                }

                if (
                    error.message &&
                    (error.message.includes("no longer exists") ||
                        error.message.includes("not valid for capture") ||
                        error.message.includes("not accessible"))
                ) {
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                this.handleScreenCaptureFailure();
            }
        }, 100);
    }

    async recoverFromInvalidTab() {
        if (this.isTabSwitching) {
            return true;
        }

        try {
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!activeTab) {
                return false;
            }

            const isNewTab = !this.screenCapture.attachedTabs.has(activeTab.id);
            const result = await this.screenCapture.switchToTab(activeTab.id);
            return result.success;
        } catch (error) {
            console.error("Error during recovery:", error);
            return false;
        }
    }

    async checkAndSwitchToActiveTab() {
        try {
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!activeTab) {
                return;
            }

            const currentTabId = this.screenCapture.getCurrentTabId();
            const isNewTab = !this.screenCapture.attachedTabs.has(activeTab.id);

            if (
                currentTabId !== activeTab.id ||
                !this.screenCapture.hasStream()
            ) {
                // Let onActivated handle the switch
            }
        } catch (error) {
            console.error("Error in fallback tab check:", error);
            throw error;
        }
    }

    stopScreenshotStreaming() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }

        if (this.screenCapture.isActive()) {
            this.screenCapture.stopRecording();
        }

        this.previewManager.stopPreview();
        streamingLogger.logInfo("📹 Video stream stopped");
    }

    stopAudioStreaming() {
        this.audioCapture.stopAudioStreaming();
    }

    async startAudioStreaming() {
        return this.audioCapture.startAudioStreaming();
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
        this.resetInactivityTimer();
        this.speechRecognition.setState({
            isListening: this.stateManager.isListening(),
            audioStreamingStarted: this.audioStreamingStarted,
            videoStreamingStarted: this.videoStreamingStarted,
        });
        this.speechRecognition.setSpeechBuffer(this.speechBuffer);
        this.speechRecognition.startLocalSpeechRecognition();
    }

    restartSpeechRecognition() {
        this.speechRecognition.restartSpeechRecognition();
    }

    startSpeechKeepAlive() {
        this.speechRecognition.startSpeechKeepAlive();
    }

    clearSpeechKeepAlive() {
        this.speechRecognition.clearSpeechKeepAlive();
    }

    resetInactivityTimer() {
        this.stateManager.resetInactivityTimer(() => {
            this.stopListening();
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
    }

    onAudioLevelDetected(level) {
        this.endpointDetection.onAudioLevelDetected(level);
    }

    handleSilenceDetected() {
        this.endpointDetection.handleSilenceDetected();
    }

    handleWebSpeechFinalResult() {
        this.endpointDetection.handleWebSpeechFinalResult();
    }

    triggerResponseGeneration(source) {
        this.audioStreamingStarted = false;
        this.videoStreamingStarted = false;
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
        this.videoStreamingStarted = false;
        this.endpointDetection.handleResponseTimeout();
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

    isListening() {
        return this.stateManager.isListening();
    }

    startPeriodicCleanup() {
        this.stateManager.startPeriodicCleanup(async () => {
            await this.screenCapture.validateAttachedTabs();
            await this.screenCapture.cleanupUnusedAttachments();
        });
    }

    stopPeriodicCleanup() {
        this.stateManager.stopPeriodicCleanup();
    }
}
