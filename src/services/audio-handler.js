import { GeminiLiveAPI } from "./gemini-api.js";
import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
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
                try {
                    this.speechRecognition.stop();
                } catch (err) {
                    console.warn("Error stopping speech recognition:", err);
                }
                this.speechRecognition = null;
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
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
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
        if (this.audioWorkletNode) {
            this.audioWorkletNode.disconnect();
            this.audioWorkletNode = null;
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

                if (maxAmplitude !== undefined) {
                    this.onAudioLevelDetected(maxAmplitude);
                }
            }
        };

        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(
            this.audioStream
        );
        this.audioSource.connect(this.audioWorkletNode);
    }

    startScriptProcessorFallback() {
        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(
            this.audioStream
        );
        const audioProcessor =
            this.geminiAPI.audioContext.createScriptProcessor(4096, 1, 1);

        audioProcessor.onaudioprocess = (event) => {
            if (!this.geminiAPI.getConnectionStatus().isConnected) return;

            const inputData = event.inputBuffer.getChannelData(0);
            const outputData = event.outputBuffer.getChannelData(0);

            for (let i = 0; i < inputData.length; i++) {
                outputData[i] = inputData[i];
            }

            let maxAmplitude = 0;
            for (let i = 0; i < inputData.length; i++) {
                const amplitude = Math.abs(inputData[i]);
                maxAmplitude = Math.max(maxAmplitude, amplitude);
            }

            this.onAudioLevelDetected(maxAmplitude);

            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const sample = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            }

            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            this.geminiAPI.sendAudioChunk(base64);
        };

        this.audioSource.connect(audioProcessor);
    }

    stopAudioProcessing() {
        this.stopAudioStreaming();

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

            if (!this.audioStreamingStarted) {
                streamingLogger.logInfo(
                    "🎤 Speech detected - starting AUDIO & VIDEO streams"
                );
                this.audioStreamingStarted = true;
                this.videoStreamingStarted = true;
                await this.startAudioStreaming();
                this.startEndpointDetection();
            }

            this.onSpeechDetected();

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

            if (hasInterimResults && this.callbacks.interim) {
                this.callbacks.interim(latestTranscript);
            }

            if (hasFinalResults) {
                this.handleWebSpeechFinalResult();
            }
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

            this.checkForOrphanedSpeech();

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
        this.endpointDetection.isActive = true;
        this.endpointDetection.lastSpeechTime = Date.now();
        this.resetSilenceTimer();
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

        this.endpointDetection.audioLevelHistory.push(level);
        if (
            this.endpointDetection.audioLevelHistory.length >
            this.endpointDetection.audioLevelWindow
        ) {
            this.endpointDetection.audioLevelHistory.shift();
        }

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

        this.speechBuffer.isGeminiProcessing = true;
        this.setResponseTimeout();

        if (this.callbacks.status) {
            this.callbacks.status("Processing speech...", "info");
        }

        this.audioStreamingStarted = false;
        this.videoStreamingStarted = false;
    }

    setResponseTimeout() {
        this.clearResponseTimeout();

        this.endpointDetection.responseTimeout = setTimeout(() => {
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
        this.speechBuffer.isGeminiProcessing = false;
        this.speechBuffer.interimText = "";
        this.audioStreamingStarted = false;
        this.videoStreamingStarted = false;

        if (this.state.isListening && this.endpointDetection.isActive) {
            this.startEndpointDetection();
        }

        if (this.callbacks.status) {
            this.callbacks.status("Ready for next input", "info");
        }
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
