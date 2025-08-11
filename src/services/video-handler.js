import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { API_CONFIG } from "../config/api-keys.js";
import { CanvasWebmMuxer } from "./video/canvas-webm-muxer.js";
import { streamingLogger } from "../utils/streaming-logger.js";

export class VideoHandler {
    constructor(aiHandler) {
        this.aiHandler = aiHandler;

        // Video services
        this.screenCapture = new ScreenCaptureService();
        this.previewManager = new LivePreviewManager();

        // Video state
        this.videoStreamingStarted = false;
        this.screenshotInterval = null;
        this.screenCaptureFailureCount = 0;
        this.isTabSwitching = false;
        this.speechActive = false; // gate sending by speech activity

        // ADK muxer setup (lazy)
        this.isAdkMode = !!API_CONFIG?.ADK_MODE_ENABLED;
        this.muxer = this.isAdkMode ? new CanvasWebmMuxer() : null;
        this._muxerInitialized = false;
        this._micStream = null;
    }

    async setupScreenCapture() {
        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            if (tabs.length > 0) {
                const setupResult = await this.screenCapture.setup(tabs[0].id);
                if (!setupResult.success) {
                    throw new Error(
                        setupResult.error || "Failed to setup screen capture"
                    );
                }
            } else {
                throw new Error("No active tab found");
            }

            this.setupTabSwitching();
            this.startScreenshotStreaming();

            this.screenCapture.preAttachToVisibleTabs().catch((error) => {
                console.warn("Background pre-attachment failed:", error);
            });

            return { success: true };
        } catch (error) {
            console.error("Screen capture setup failed:", error);
            throw error;
        }
    }

    setupTabSwitching() {
        this.tabListeners = {
            onActivated: async (activeInfo) => {
                const shouldSwitch = !this.isTabSwitching;

                if (shouldSwitch) {
                    try {
                        this.isTabSwitching = true;
                        // Pause sending and clear pending frames before switch
                        this.videoStreamingStarted = false;
                        try {
                            this.aiHandler?.geminiAPI?.clearPendingVideoFrames?.();
                        } catch (_) {}
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
                        // Skip first tick instead of fixed delay; gating will prevent stale sends
                        this._skipNextTick = true;
                        this.isTabSwitching = false;
                    }
                }
            },
            onUpdated: async (tabId, changeInfo, tab) => {
                if (changeInfo.status === "complete") {
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
                if (tab.active) {
                    // Will be handled by onActivated listener
                }
            },
            onFocusChanged: async (windowId) => {
                try {
                    await this.screenCapture.validateAttachedTabs();
                } catch (error) {
                    console.error(
                        "Failed to handle window focus change:",
                        error
                    );
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
                "Multiple screen capture failures detected, stopping video streaming"
            );

            // This will be handled by MultimediaOrchestrator
            return { shouldStop: true, reason: "screen_capture_failed" };
        }

        return { shouldStop: false };
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
                    "Multiple critical failures detected, stopping video streaming"
                );

                return { shouldStop: true, reason: "critical_failures" };
            }
        }

        return { shouldStop: false };
    }

    async startScreenshotStreaming() {
        if (
            !this.screenCapture.hasStream() ||
            (!this.isAdkMode && !this.aiHandler.isGeminiConnectionActive())
        ) {
            return;
        }

        this.previewManager.startPreview();

        // Initialize ADK JPEG path (no muxer start)
        if (this.isAdkMode && !this._muxerInitialized) {
            try {
                console.log(
                    "[ADK] JPEG streaming path active (image/jpeg frames)"
                );
                this._muxerInitialized = true;
                console.log("[ADK] JPEG path ready");
            } catch (err) {
                console.warn("[ADK] JPEG path init warning:", err);
            }
        }
        this.screenCapture.startRecording();
        streamingLogger.logInfo("📹 Video stream started (10 FPS)");

        this.screenshotInterval = setInterval(async () => {
            if (this._skipNextTick) {
                this._skipNextTick = false;
                streamingLogger.logInfo("SKIP first tick after tab switch");
                // Do NOT auto-resume here; wait for stable frame + speech gate
                return;
            }
            // Prevent auto-resume; only resume when first stable frame is captured below
            if (!this.screenCapture.hasStream()) {
                const recoverySuccess = await this.recoverFromInvalidTab();
                if (!recoverySuccess) {
                    this.stopScreenshotStreaming();
                    return;
                }
            }

            try {
                // Actively self-heal: switch immediately if mismatch
                try {
                    const [activeTab] = await chrome.tabs.query({
                        active: true,
                        currentWindow: true,
                    });
                    const currentTabId = this.screenCapture.getCurrentTabId();
                    if (activeTab && currentTabId !== activeTab.id) {
                        console.log(
                            `MISMATCH detected (current=${currentTabId}, active=${activeTab.id}) → switching now`
                        );
                        await this.screenCapture.switchToTab(activeTab.id);
                        // Skip this tick to avoid capturing mid-transition
                        return;
                    }
                } catch (_) {}
                const currIdBefore = this.screenCapture.getCurrentTabId();
                const frameData = await this.screenCapture.captureFrame();
                const currIdAfter = this.screenCapture.getCurrentTabId();
                // Guard: if tabId changed mid-tick, drop this frame
                if (currIdBefore !== currIdAfter) {
                    streamingLogger.logInfo(
                        `DROP frame due to tab change mid-tick (pre=${currIdBefore} post=${currIdAfter})`
                    );
                    return;
                }
                this.screenCaptureFailureCount = 0;
                this.previewManager.updatePreview(frameData);
                streamingLogger.logInfo(
                    `CAPTURED frame from tab=${currIdAfter} (pre=${currIdBefore})`
                );

                // Resume sending only after first stable frame post-switch and while speech is active
                if (this.speechActive && !this.videoStreamingStarted) {
                    this.videoStreamingStarted = true;
                    streamingLogger.logInfo(
                        "RESUME video sending after stable frame"
                    );
                    // No muxer start for JPEG path
                }

                // No muxer ensure-start for JPEG path

                if (this.videoStreamingStarted && this.speechActive) {
                    if (this.isAdkMode) {
                        try {
                            // frameData is base64 JPEG; send as bytes
                            const byteChars = atob(frameData);
                            const len = byteChars.length;
                            const bytes = new Uint8Array(len);
                            for (let i = 0; i < len; i++)
                                bytes[i] = byteChars.charCodeAt(i);
                            const blob = new Blob([bytes], {
                                type: "image/jpeg",
                            });
                            this.aiHandler.sendAdkVideoChunk(blob, {
                                mime: "image/jpeg",
                                durMs: 100,
                            });
                        } catch (e) {
                            console.warn("[ADK] JPEG send failed", e);
                        }
                    } else if (this.aiHandler.isGeminiConnectionActive()) {
                        // Legacy Gemini path
                        const status =
                            this.aiHandler.geminiAPI?.getConnectionStatus?.();
                        streamingLogger.logInfo(
                            `FRAME ready tab=${this.screenCapture.getCurrentTabId()} setup=${!!status?.isSetupComplete}`
                        );
                        if (status?.isSetupComplete) {
                            this.aiHandler.sendVideoData(frameData);
                        } else {
                            streamingLogger.logInfo(
                                `FRAME skipped (setup incomplete) tab=${this.screenCapture.getCurrentTabId()}`
                            );
                        }
                    }
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

                const failureResult = await this.handleScreenCaptureFailure();
                if (failureResult.shouldStop) {
                    this.stopScreenshotStreaming();
                }
            }
        }, 100);
    }

    stopScreenshotStreaming() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }

        if (this.screenCapture.isActive()) {
            this.screenCapture.stopRecording();
        }

        // Stop muxer if running
        if (this.isAdkMode && this.muxer) {
            try {
                this.muxer.stop();
                // After stopping, ensure no further chunks are sent for this turn
                this.videoStreamingStarted = false;
            } catch (_) {}
        }

        this.previewManager.stopPreview();
        streamingLogger.logInfo("📹 Video stream stopped");
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

    async cleanup() {
        await this.screenCapture.cleanup();
        this.cleanupTabListeners();
    }

    // State management
    setVideoStreamingStarted(started) {
        this.videoStreamingStarted = started;
        if (this.isAdkMode && this.muxer) {
            try {
                if (!started) {
                    this.muxer.stop();
                }
            } catch (_) {}
        }
    }

    isVideoStreamingStarted() {
        return this.videoStreamingStarted;
    }
}
