import { GeminiLiveAPI } from "./gemini-api.js";
import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { AudioCaptureService } from "./audio/audio-capture-service.js";
import { SpeechRecognitionService } from "./audio/speech-recognition-service.js";
import { EndpointDetectionService } from "./audio/endpoint-detection-service.js";
import { streamingLogger } from "../utils/streaming-logger.js";

export class AudioHandler {
    constructor() {
        this.state = {
            isListening: false,
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

        this.geminiAPI = new GeminiLiveAPI();
        this.screenCapture = new ScreenCaptureService();
        this.previewManager = new LivePreviewManager();
        this.audioCapture = new AudioCaptureService(this.geminiAPI);
        this.speechRecognition = new SpeechRecognitionService();
        this.endpointDetection = new EndpointDetectionService();
        this.inactivityTimer = null;
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
                if (this.callbacks.interim) {
                    this.callbacks.interim(text);
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
            onResponseTimeout: () => this.handleResponseTimeout(),
            onResponseGeneration: (source) => {
                this.audioStreamingStarted = false;
                this.videoStreamingStarted = false;
            },
            onStatus: (status, type, duration) => {
                if (this.callbacks.status) {
                    this.callbacks.status(status, type, duration);
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
            this.clearResponseTimeout();
            this.speechBuffer.isGeminiProcessing = false;
            this.speechBuffer.interimText = "";
            this.audioStreamingStarted = false;
            this.videoStreamingStarted = false;

            if (this.state.isListening && this.endpointDetection.isActive) {
                this.startEndpointDetection();
            }

            if (this.callbacks.botResponse) {
                this.callbacks.botResponse(data);
            }
        }
    }

    handleStreamingUpdate(update) {
        if (update.text) {
            if (
                this.speechBuffer.interimText.trim() &&
                this.callbacks.transcription
            ) {
                const userMessage = this.speechBuffer.interimText.trim();
                this.callbacks.transcription(userMessage);
                this.speechBuffer.interimText = "";
            }

            if (this.callbacks.botResponse) {
                this.callbacks.botResponse({
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

            this.state.isListening = true;

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
        this.tabListeners = {
            onActivated: async (activeInfo) => {
                const shouldSwitch =
                    this.state.isListening && !this.isTabSwitching;

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
                    this.state.isListening &&
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
                if (tab.active && this.state.isListening) {
                    // Will be handled by onActivated listener
                }
            },
            onFocusChanged: async (windowId) => {
                if (this.state.isListening) {
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

            if (this.callbacks.status) {
                this.callbacks.status(
                    "Screen capture failed - stopping listening mode",
                    "error",
                    5000
                );
            }

            await this.stopListening();

            if (this.callbacks.listeningStopped) {
                this.callbacks.listeningStopped("screen_capture_failed");
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

                if (this.callbacks.status) {
                    this.callbacks.status(
                        "Critical failures detected - stopping listening mode",
                        "error",
                        5000
                    );
                }

                await this.stopListening();

                if (this.callbacks.listeningStopped) {
                    this.callbacks.listeningStopped("critical_failures");
                }
            }
        }
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: "Not currently listening" };
        }

        try {
            this.state.isListening = false;

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
            this.state.isListening = false;
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
            isListening: this.state.isListening,
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
        this.clearInactivityTimer();

        this.inactivityTimer = setTimeout(() => {
            this.stopListening();
            if (this.callbacks.status) {
                this.callbacks.status("Session timed out", "warning", 5000);
            }
        }, 20 * 60 * 1000);
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    startEndpointDetection() {
        this.endpointDetection.setState({
            isListening: this.state.isListening,
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

    isListening() {
        return this.state.isListening;
    }

    startPeriodicCleanup() {
        this.cleanupTimer = setInterval(async () => {
            if (this.state.isListening) {
                try {
                    await this.screenCapture.validateAttachedTabs();
                    await this.screenCapture.cleanupUnusedAttachments();
                } catch (error) {
                    console.error("Error during periodic cleanup:", error);
                }
            }
        }, 30000);
    }

    stopPeriodicCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}
