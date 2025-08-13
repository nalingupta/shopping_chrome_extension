import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { streamingLogger } from "../utils/streaming-logger.js";
import { FEATURES, DEFAULT_CAPTURE_FPS } from "../config/features.js";

export class VideoHandler {
    constructor(aiHandler) {
        this.aiHandler = aiHandler;

        // Video services
        this.screenCapture = new ScreenCaptureService();
        this.previewManager = new LivePreviewManager();

        // Video state
        this.videoStreamingStarted = false;
        this.screenshotInterval = null;
        this._fpsWatcherInterval = null;
        this._currentCaptureFps = null;
        this._tickSeries = [];
        this._tickRunType = null; // 'hit' | 'miss'
        this._tickRunCount = 0;
        this._tickTotal = 0;
        this._tickHits = 0;
        this._tickMisses = 0;
        this._captureStartWallMs = null;
        // Segment-based per-active-tab runs (each contiguous active period becomes a line)
        this._segments = [];
        this._currentSegment = null; // { tabId, series:[], runType, runCount, total, hits, misses }
        this._tabUrlCache = new Map();
        this.screenCaptureFailureCount = 0;
        this.isTabSwitching = false;
        this.speechActive = false; // gate sending by speech activity

        // Substitution / white-frame support
        this._suppressionActive = false;
        this._suppressionReason = null; // 'navigation'|'restricted'|'minimized'|'incognito_permission'|'file_permission'|'tab_removed'
        this._suppressionStartWallMs = null;
        this._firstFrameDims = null; // { width, height } set once on first real frame
        this._whiteFrameCache = null; // base64 JPEG for current chosen dims
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
                            // legacy path removed
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
                        } else {
                            // Static path: no immediate capture (use periodic cadence only)
                        }
                    } catch (error) {
                        console.warn("Tab activation switch failed:", error);
                    } finally {
                        // For legacy debugger flow, skip the first tick after a tab switch
                        if (!FEATURES.USE_STATIC_SCREEN_CAPTURE) {
                            this._skipNextTick = true;
                        }
                        this.isTabSwitching = false;
                    }
                }
            },
            onUpdated: async (tabId, changeInfo, tab) => {
                if (changeInfo.status === "loading") {
                    // Navigation started; hint suppression window (capture-first will end early on success)
                    this._beginSuppression("navigation");
                }
                if (changeInfo.status === "complete") {
                    this._endSuppression("navigation");
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
                // Restricted URL hint using centralized check when URL changes
                if (changeInfo.url) {
                    try {
                        const isRestricted = this.screenCapture.isRestrictedUrl(
                            tab.url
                        );
                        if (isRestricted) this._beginSuppression("restricted");
                        else this._endSuppression("restricted");
                    } catch (_) {}
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
                // Minimized/unfocused hint
                if (windowId === chrome.windows.WINDOW_ID_NONE) {
                    this._beginSuppression("minimized");
                } else {
                    try {
                        const win = await chrome.windows.get(windowId);
                        if (win && win.state === "minimized") {
                            this._beginSuppression("minimized");
                        } else {
                            this._endSuppression("minimized");
                        }
                    } catch (_) {}
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

    startScreenshotStreaming() {
        if (
            !this.screenCapture.hasStream() ||
            !this.aiHandler.isGeminiConnectionActive()
        ) {
            return;
        }

        // Determine capture fps: server override > 0 wins; else default by feature flag
        const backendFps = this.aiHandler?.serverAPI?.getCaptureFps?.();
        const defaultFps = DEFAULT_CAPTURE_FPS; // centralized default
        const captureFps =
            typeof backendFps === "number" && backendFps > 0
                ? backendFps
                : defaultFps;
        const intervalMs = Math.max(10, Math.floor(1000 / captureFps));
        this._currentCaptureFps = captureFps;
        // Initialize drift-aware baseline at stream start
        this._intervalMs = intervalMs;
        this._basePerfMs = performance?.now?.() || Date.now();
        this._expectedTickIndex = 0;

        // Align preview FPS to capture FPS and start services
        this._resetTickSeries();
        this._resetSegments();
        this.previewManager.setFps?.(captureFps);
        this.previewManager.startPreview();
        streamingLogger.logInfo(
            `📹 Video stream started (continuous); captureFps=${captureFps}`
        );
        this._captureStartWallMs = Date.now();

        const captureLoop = async () => {
            // Drift-aware gap insertion
            try {
                const nowPerf = performance?.now?.() || Date.now();
                if (this._basePerfMs == null) this._basePerfMs = nowPerf;
                if (this._intervalMs == null) this._intervalMs = intervalMs;
                const expectedIndex = Math.floor(
                    (nowPerf - this._basePerfMs) / this._intervalMs
                );
                const gap = Math.max(
                    0,
                    expectedIndex - this._expectedTickIndex
                );
                if (gap > 0) {
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    for (let i = 0; i < gap; i++) {
                        this._noteTick("miss");
                        this._noteSegmentTick("miss");
                    }
                    this._expectedTickIndex = expectedIndex;
                }
            } catch (_) {}
            if (this._skipNextTick) {
                this._skipNextTick = false;
                streamingLogger.logInfo("SKIP first tick after tab switch");
                // Do NOT auto-resume here; wait for stable frame + speech gate
                await this._ensureSegment(this.screenCapture.getCurrentTabId());
                this._noteTick("miss");
                this._noteSegmentTick("miss");
                this._expectedTickIndex += 1;
                return;
            }
            // Prevent auto-resume; only resume when first stable frame is captured below
            if (!this.screenCapture.hasStream()) {
                const recoverySuccess = await this.recoverFromInvalidTab();
                if (!recoverySuccess) {
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    this._noteTick("miss");
                    this._noteSegmentTick("miss");
                    this.stopScreenshotStreaming();
                    this._expectedTickIndex += 1;
                    return;
                }
            }

            try {
                // Actively self-heal: switch immediately if mismatch
                try {
                    if (!FEATURES.USE_STATIC_SCREEN_CAPTURE) {
                        const [activeTab] = await chrome.tabs.query({
                            active: true,
                            currentWindow: true,
                        });
                        const currentTabId =
                            this.screenCapture.getCurrentTabId();
                        if (activeTab && currentTabId !== activeTab.id) {
                            console.warn(
                                `MISMATCH detected (current=${currentTabId}, active=${activeTab.id}) → switching now`
                            );
                            await this._ensureSegment(
                                this.screenCapture.getCurrentTabId()
                            );
                            this._noteTick(false);
                            this._noteSegmentTick(false);
                            await this.screenCapture.switchToTab(activeTab.id);
                            // Skip this tick to avoid capturing mid-transition
                            this._expectedTickIndex += 1;
                            return;
                        }
                    } else {
                        // In static mode, still warn if we detect a mismatch for diagnostics only
                        const [activeTab] = await chrome.tabs.query({
                            active: true,
                            currentWindow: true,
                        });
                        const currentTabId =
                            this.screenCapture.getCurrentTabId();
                        if (
                            activeTab &&
                            currentTabId &&
                            currentTabId !== activeTab.id
                        ) {
                            console.warn(
                                `Static capture mismatch (current=${currentTabId}, active=${activeTab.id})`
                            );
                        }
                    }
                } catch (_) {}
                const currIdBefore = this.screenCapture.getCurrentTabId();
                await this._ensureSegment(currIdBefore);
                const frameData = await this.screenCapture.captureFrame();
                const currIdAfter = this.screenCapture.getCurrentTabId();
                // Guard: if tabId changed mid-tick, drop this frame
                if (currIdBefore !== currIdAfter) {
                    streamingLogger.logInfo(
                        `DROP frame due to tab change mid-tick (pre=${currIdBefore} post=${currIdAfter})`
                    );
                    this._noteTick("miss");
                    this._noteSegmentTick("miss");
                    this._expectedTickIndex += 1;
                    return;
                }
                this.screenCaptureFailureCount = 0;
                // Continuous streaming: send to backend first (priority)
                if (this.aiHandler.isGeminiConnectionActive()) {
                    const sessionStart =
                        this.aiHandler.getSessionStartMs?.() || null;
                    const tsMs = sessionStart
                        ? (performance?.now?.() || Date.now()) - sessionStart
                        : performance?.now?.() || Date.now();
                    this.aiHandler.sendImageFrame(frameData, tsMs);
                }

                // Then update live preview (lower priority)
                this.previewManager.updatePreview(frameData);
                streamingLogger.logInfo(
                    `CAPTURED frame from tab=${currIdAfter} (pre=${currIdBefore})`
                );
                this._noteTick("hit");
                this._noteSegmentTick("hit");
                this._expectedTickIndex += 1;
                // Capture first frame dimensions once for future white frames
                this._maybeCaptureFirstDimsAsync(frameData);
            } catch (error) {
                if (
                    error.message &&
                    error.message.includes("Detached while handling command")
                ) {
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    this._noteTick("miss");
                    this._noteSegmentTick("miss");
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        this._expectedTickIndex += 1;
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        this._expectedTickIndex += 1;
                        return;
                    }
                }

                if (error.message.includes("Debugger not attached")) {
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    this._noteTick("miss");
                    this._noteSegmentTick("miss");
                    this._expectedTickIndex += 1;
                    return;
                }

                if (
                    error.message &&
                    (error.message.includes("no longer exists") ||
                        error.message.includes("not valid for capture") ||
                        error.message.includes("not accessible"))
                ) {
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    this._noteTick(false);
                    this._noteSegmentTick(false);
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        this._expectedTickIndex += 1;
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        this._expectedTickIndex += 1;
                        return;
                    }
                }

                // Gracefully handle static capture skip conditions without stopping the stream
                const msg = String(error?.message || "");
                const isStaticSkip =
                    msg.includes("restricted_or_blocked") ||
                    msg.includes("window_minimized_or_unfocused") ||
                    msg.includes("no_active_tab");
                const isRateOrBackoff =
                    msg.includes("rate_limited") ||
                    msg.includes("static_backoff");

                // Substitution only for must-have blocking reasons; not for rate/backoff/drift
                if (isStaticSkip) {
                    // Begin suppression if not already in one
                    if (!this._suppressionActive) {
                        if (msg.includes("restricted_or_blocked"))
                            this._beginSuppression("restricted");
                        else if (msg.includes("window_minimized_or_unfocused"))
                            this._beginSuppression("minimized");
                        else if (msg.includes("no_active_tab"))
                            this._beginSuppression("tab_removed");
                    }

                    // If no prior real frame yet, do NOT send a fake; treat as a miss only
                    if (!this._firstFrameDims) {
                        await this._ensureSegment(
                            this.screenCapture.getCurrentTabId()
                        );
                        this._noteTick("miss");
                        this._noteSegmentTick("miss");
                        this._expectedTickIndex += 1;
                        return;
                    }

                    const whiteBase64 = await this._ensureWhiteFrameBase64();
                    if (whiteBase64) {
                        // Send to backend
                        if (this.aiHandler.isGeminiConnectionActive()) {
                            const sessionStart =
                                this.aiHandler.getSessionStartMs?.() || null;
                            const tsMs = sessionStart
                                ? (performance?.now?.() || Date.now()) -
                                  sessionStart
                                : performance?.now?.() || Date.now();
                            this.aiHandler.sendImageFrame(whiteBase64, tsMs);
                        }
                        // Update preview
                        this.previewManager.updatePreview(whiteBase64);
                        streamingLogger.logInfo(
                            `SUBSTITUTE white frame due to: ${msg}`
                        );
                        this._noteTick("substitute");
                        this._noteSegmentTick("substitute");
                        this._expectedTickIndex += 1;
                        return;
                    } else {
                        // fall back to miss if we couldn't generate
                        this._noteTick("miss");
                        this._noteSegmentTick("miss");
                        this._expectedTickIndex += 1;
                        return;
                    }
                }

                if (isRateOrBackoff) {
                    streamingLogger.logInfo(`SKIP tick: ${msg}`);
                    await this._ensureSegment(
                        this.screenCapture.getCurrentTabId()
                    );
                    this._noteTick("miss");
                    this._noteSegmentTick("miss");
                    this._expectedTickIndex += 1;
                    return;
                }

                const failureResult = await this.handleScreenCaptureFailure();
                if (failureResult.shouldStop) {
                    this.stopScreenshotStreaming();
                }
            }
        };

        // helper to (re)start interval aligned to current baseline
        const startAlignedInterval = () => {
            if (this.screenshotInterval) {
                clearInterval(this.screenshotInterval);
                this.screenshotInterval = null;
            }
            this.screenshotInterval = setInterval(captureLoop, intervalMs);
        };

        // Start recording first, then perform one immediate capture to avoid initial "-1" miss,
        // then start the periodic interval. Keep this lean, no async/await signature changes.
        Promise.resolve(this.screenCapture.startRecording())
            .catch(() => {})
            .finally(() => {
                // Fire one immediate tick, then start interval regardless of outcome
                Promise.resolve(captureLoop())
                    .catch(() => {})
                    .finally(() => startAlignedInterval());
            });
    }

    applyServerCaptureFps(newFps) {
        const n = Number(newFps);
        if (!Number.isFinite(n) || n <= 0) return;
        if (this._currentCaptureFps && this._currentCaptureFps === n) return;
        const wasActive = !!this.screenshotInterval;
        if (wasActive) {
            this.stopScreenshotStreaming();
            this.startScreenshotStreaming();
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
        this._emitTickSeriesAndReset();
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

    // (instant capture removed)

    async cleanup() {
        await this.screenCapture.cleanup();
        this.cleanupTabListeners();
    }

    // State management
    setVideoStreamingStarted(started) {
        this.videoStreamingStarted = started;
    }

    isVideoStreamingStarted() {
        return this.videoStreamingStarted;
    }

    // --- Tick series helpers ---
    _resetTickSeries() {
        this._tickSeries = [];
        this._tickRunType = null;
        this._tickRunCount = 0;
        this._tickTotal = 0;
        this._tickHits = 0;
        this._tickMisses = 0;
    }

    _beginSuppression(reason) {
        if (this._suppressionActive && this._suppressionReason === reason)
            return;
        this._suppressionActive = true;
        this._suppressionReason = reason;
        this._suppressionStartWallMs = Date.now();
    }

    _endSuppression(reason) {
        if (!this._suppressionActive) return;
        if (
            reason &&
            this._suppressionReason &&
            reason !== this._suppressionReason
        )
            return;
        this._suppressionActive = false;
        this._suppressionReason = null;
        this._suppressionStartWallMs = null;
    }

    _getEstimatedDims() {
        try {
            const ratio = Math.max(1, window.devicePixelRatio || 1);
            const w = Math.max(
                1,
                Math.floor((window.screen?.width || 1280) * ratio)
            );
            const h = Math.max(
                1,
                Math.floor((window.screen?.height || 720) * ratio)
            );
            return { width: w, height: h };
        } catch (_) {
            return { width: 1280, height: 720 };
        }
    }

    async _ensureWhiteFrameBase64() {
        if (this._whiteFrameCache) return this._whiteFrameCache;
        const dims = this._firstFrameDims || this._getEstimatedDims();
        try {
            const canvas = document.createElement("canvas");
            canvas.width = dims.width;
            canvas.height = dims.height;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const base64 = await new Promise((resolve) => {
                try {
                    canvas.toBlob(
                        (blob) => {
                            try {
                                if (!blob) return resolve(null);
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    try {
                                        const dataUrl = reader.result;
                                        if (typeof dataUrl === "string") {
                                            const idx = dataUrl.indexOf(",");
                                            resolve(
                                                idx >= 0
                                                    ? dataUrl.slice(idx + 1)
                                                    : dataUrl
                                            );
                                        } else {
                                            resolve(null);
                                        }
                                    } catch (_) {
                                        resolve(null);
                                    }
                                };
                                reader.onerror = () => resolve(null);
                                reader.readAsDataURL(blob);
                            } catch (_) {
                                resolve(null);
                            }
                        },
                        "image/jpeg",
                        0.8
                    );
                } catch (_) {
                    resolve(null);
                }
            });

            if (typeof base64 === "string") {
                this._whiteFrameCache = base64;
                return base64;
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    _maybeCaptureFirstDimsAsync(base64Jpeg) {
        if (this._firstFrameDims) return;
        try {
            const img = new Image();
            img.onload = () => {
                if (!this._firstFrameDims) {
                    this._firstFrameDims = {
                        width: img.width,
                        height: img.height,
                    };
                    // Invalidate cached white frame if dims were based on estimates
                    this._whiteFrameCache = null;
                }
                // Pre-warm white-frame cache off the interval tick
                try {
                    setTimeout(() => {
                        Promise.resolve(this._ensureWhiteFrameBase64()).catch(
                            () => {}
                        );
                    }, 0);
                } catch (_) {}
            };
            img.onerror = () => {};
            img.src = `data:image/jpeg;base64,${base64Jpeg}`;
        } catch (_) {}
    }

    _noteTick(kind) {
        this._tickTotal += 1;
        if (kind === "hit") this._tickHits += 1;
        else if (kind === "miss") this._tickMisses += 1;
        if (this._tickRunType === kind) {
            this._tickRunCount += 1;
        } else {
            if (this._tickRunType !== null) {
                this._tickSeries.push({
                    type: this._tickRunType,
                    count: this._tickRunCount,
                });
            }
            this._tickRunType = kind;
            this._tickRunCount = 1;
        }
    }

    _emitTickSeriesAndReset() {
        // flush current run
        if (this._tickRunType !== null && this._tickRunCount > 0) {
            this._tickSeries.push({
                type: this._tickRunType,
                count: this._tickRunCount,
            });
        }
        if (this._tickSeries.length > 0) {
            this.#logSeriesLine(
                "Tick series",
                this._tickSeries,
                this._tickMisses,
                this._tickTotal,
                undefined,
                this._currentCaptureFps,
                this._captureStartWallMs != null
                    ? Math.max(0, Date.now() - this._captureStartWallMs)
                    : undefined
            );
        }
        // per-tab series
        try {
            // finalize current and log segments in order
            this.#finalizeCurrentSegment();
            for (const seg of this._segments) {
                const series = this.#finalizeSeriesCopy(seg);
                if (series.length > 0) {
                    const url = this._tabUrlCache.get(seg.tabId) || "unknown";
                    this.#logSeriesLine(
                        `Tab ${seg.tabId}`,
                        series,
                        seg.misses || 0,
                        seg.total || 0,
                        url,
                        undefined
                    );
                }
            }
        } catch (_) {}
        this._resetTickSeries();
        this._resetSegments();
    }

    #logSeriesLine(prefix, series, misses, total, url, fps, durationMs) {
        let fmt = `${prefix}: `;
        const styles = [];
        series.forEach((run, idx) => {
            let token = "";
            let color = "color:#ef4444";
            if (run.type === "hit") {
                token = `+${run.count}`;
                color = "color:#16a34a";
            } else if (run.type === "miss") {
                token = `-${run.count}`;
            } else if (run.type === "substitute") {
                token = `-${run.count} (substituted)`;
            } else {
                token = `?${run.count}`;
            }
            fmt += `%c${token}`;
            styles.push(color);
            if (idx < series.length - 1) fmt += ", ";
        });
        const pct = total > 0 ? Math.round((misses / total) * 100) : 0;
        fmt += ` | Miss freq: ${misses}/${total} (${pct}%)`;
        if (url) fmt += ` (url: ${url})`;
        if (typeof fps === "number") fmt += ` (captureFps: ${fps})`;
        if (typeof durationMs === "number") {
            const secs = Math.round(durationMs / 1000);
            fmt += ` (duration: ${secs}s)`;
        }
        try {
            // eslint-disable-next-line no-console
            console.log(fmt, ...styles);
        } catch (_) {}
    }

    _resetSegments() {
        this._segments = [];
        this._currentSegment = null;
        try {
            this._tabUrlCache.clear();
        } catch (_) {}
    }

    async _ensureSegment(tabId) {
        const id = tabId ?? "unknown";
        if (!this._currentSegment || this._currentSegment.tabId !== id) {
            this.#finalizeCurrentSegment();
            this._currentSegment = {
                tabId: id,
                series: [],
                runType: null,
                runCount: 0,
                total: 0,
                hits: 0,
                misses: 0,
            };
            this._segments.push(this._currentSegment);
            try {
                if (typeof id === "number") {
                    const tab = await chrome.tabs.get(id);
                    if (tab?.url) this._tabUrlCache.set(id, tab.url);
                }
            } catch (_) {}
        }
    }

    _noteSegmentTick(kind) {
        if (!this._currentSegment) return;
        const data = this._currentSegment;
        data.total += 1;
        if (kind === "hit") data.hits += 1;
        else if (kind === "miss") data.misses += 1;
        if (data.runType === kind) {
            data.runCount += 1;
        } else {
            if (data.runType !== null) {
                data.series.push({ type: data.runType, count: data.runCount });
            }
            data.runType = kind;
            data.runCount = 1;
        }
    }

    #finalizeCurrentSegment() {
        if (!this._currentSegment) return;
        const data = this._currentSegment;
        if (data.runType !== null && data.runCount > 0) {
            data.series.push({ type: data.runType, count: data.runCount });
        }
    }

    #finalizeSeriesCopy(data) {
        // Current run was already flushed by finalizeCurrentSegment() before printing
        return [...data.series];
    }
}
