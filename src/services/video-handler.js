import { ScreenCaptureService } from "./screen-capture-service.js";
import { LivePreviewManager } from "./live-preview-manager.js";
import { streamingLogger } from "../utils/streaming-logger.js";
import { FEATURES } from "../config/features.js";

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
        this._tabTickMap = new Map(); // tabId -> { series, runType, runCount, total, hits, misses }
        this.screenCaptureFailureCount = 0;
        this.isTabSwitching = false;
        this.speechActive = false; // gate sending by speech activity
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

    startScreenshotStreaming() {
        if (
            !this.screenCapture.hasStream() ||
            !this.aiHandler.isGeminiConnectionActive()
        ) {
            return;
        }

        // Determine capture fps: server override > 0 wins; else default by feature flag
        const backendFps = this.aiHandler?.serverAPI?.getCaptureFps?.();
        const defaultFps = 1; // enforce 1 FPS default in all modes per requirement
        const captureFps =
            typeof backendFps === "number" && backendFps > 0
                ? backendFps
                : defaultFps;
        const intervalMs = Math.max(10, Math.floor(1000 / captureFps));

        // Align preview FPS to capture FPS and start services
        this._resetTickSeries();
        this._resetPerTabSeries();
        this.previewManager.setFps?.(captureFps);
        this.previewManager.startPreview();
        this.screenCapture.startRecording();
        streamingLogger.logInfo(
            `📹 Video stream started (continuous); captureFps=${captureFps}`
        );

        this.screenshotInterval = setInterval(async () => {
            if (this._skipNextTick) {
                this._skipNextTick = false;
                streamingLogger.logInfo("SKIP first tick after tab switch");
                // Do NOT auto-resume here; wait for stable frame + speech gate
                this._noteTick(false);
                this._noteTabTick(
                    this.screenCapture.getCurrentTabId() ?? "unknown",
                    false
                );
                return;
            }
            // Prevent auto-resume; only resume when first stable frame is captured below
            if (!this.screenCapture.hasStream()) {
                const recoverySuccess = await this.recoverFromInvalidTab();
                if (!recoverySuccess) {
                    this._noteTick(false);
                    this._noteTabTick(
                        this.screenCapture.getCurrentTabId() ?? "unknown",
                        false
                    );
                    this.stopScreenshotStreaming();
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
                            this._noteTick(false);
                            this._noteTabTick(
                                this.screenCapture.getCurrentTabId() ??
                                    "unknown",
                                false
                            );
                            await this.screenCapture.switchToTab(activeTab.id);
                            // Skip this tick to avoid capturing mid-transition
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
                const frameData = await this.screenCapture.captureFrame();
                const currIdAfter = this.screenCapture.getCurrentTabId();
                // Guard: if tabId changed mid-tick, drop this frame
                if (currIdBefore !== currIdAfter) {
                    streamingLogger.logInfo(
                        `DROP frame due to tab change mid-tick (pre=${currIdBefore} post=${currIdAfter})`
                    );
                    this._noteTick(false);
                    this._noteTabTick(currIdBefore ?? "unknown", false);
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
                this._noteTick(true);
                this._noteTabTick(currIdAfter ?? "unknown", true);
            } catch (error) {
                if (
                    error.message &&
                    error.message.includes("Detached while handling command")
                ) {
                    this._noteTick(false);
                    this._noteTabTick(
                        this.screenCapture.getCurrentTabId() ?? "unknown",
                        false
                    );
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                if (error.message.includes("Debugger not attached")) {
                    this._noteTick(false);
                    this._noteTabTick(
                        this.screenCapture.getCurrentTabId() ?? "unknown",
                        false
                    );
                    return;
                }

                if (
                    error.message &&
                    (error.message.includes("no longer exists") ||
                        error.message.includes("not valid for capture") ||
                        error.message.includes("not accessible"))
                ) {
                    this._noteTick(false);
                    this._noteTabTick(
                        this.screenCapture.getCurrentTabId() ?? "unknown",
                        false
                    );
                    const recoverySuccess = await this.recoverFromInvalidTab();
                    if (recoverySuccess) {
                        return;
                    } else {
                        this.stopScreenshotStreaming();
                        return;
                    }
                }

                // Gracefully handle static capture skip conditions without stopping the stream
                const msg = String(error?.message || "");
                const isStaticSkip =
                    msg.includes("static_backoff") ||
                    msg.includes("restricted_or_blocked") ||
                    msg.includes("window_minimized_or_unfocused") ||
                    msg.includes("no_active_tab");

                if (isStaticSkip) {
                    streamingLogger.logInfo(`SKIP tick: ${msg}`);
                    this._noteTick(false);
                    this._noteTabTick(
                        this.screenCapture.getCurrentTabId() ?? "unknown",
                        false
                    );
                    return;
                }

                const failureResult = await this.handleScreenCaptureFailure();
                if (failureResult.shouldStop) {
                    this.stopScreenshotStreaming();
                }
            }
        }, intervalMs);
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

    _noteTick(isHit) {
        this._tickTotal += 1;
        if (isHit) this._tickHits += 1;
        else this._tickMisses += 1;
        const t = isHit ? "hit" : "miss";
        if (this._tickRunType === t) {
            this._tickRunCount += 1;
        } else {
            if (this._tickRunType !== null) {
                this._tickSeries.push({
                    type: this._tickRunType,
                    count: this._tickRunCount,
                });
            }
            this._tickRunType = t;
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
                this._tickTotal
            );
        }
        // per-tab series
        try {
            for (const [tabId, data] of this._tabTickMap.entries()) {
                const series = this.#finalizeSeriesCopy(data);
                if (series.length > 0) {
                    this.#logSeriesLine(
                        `Tab ${tabId}`,
                        series,
                        data.misses || 0,
                        data.total || 0
                    );
                }
            }
        } catch (_) {}
        this._resetTickSeries();
        this._resetPerTabSeries();
    }

    #logSeriesLine(prefix, series, misses, total) {
        let fmt = `${prefix}: `;
        const styles = [];
        series.forEach((run, idx) => {
            const sign = run.type === "hit" ? "+" : "-";
            const color =
                run.type === "hit" ? "color:#16a34a" : "color:#ef4444";
            fmt += `%c${sign}${run.count}`;
            styles.push(color);
            if (idx < series.length - 1) fmt += ", ";
        });
        const pct = total > 0 ? Math.round((misses / total) * 100) : 0;
        fmt += ` | Miss freq: ${misses}/${total} (${pct}%)`;
        try {
            // eslint-disable-next-line no-console
            console.log(fmt, ...styles);
        } catch (_) {}
    }

    _resetPerTabSeries() {
        this._tabTickMap.clear();
    }

    _ensureTabSeries(tabId) {
        if (!this._tabTickMap.has(tabId)) {
            this._tabTickMap.set(tabId, {
                series: [],
                runType: null,
                runCount: 0,
                total: 0,
                hits: 0,
                misses: 0,
            });
        }
        return this._tabTickMap.get(tabId);
    }

    _noteTabTick(tabId, isHit) {
        const data = this._ensureTabSeries(tabId);
        data.total += 1;
        if (isHit) data.hits += 1;
        else data.misses += 1;
        const t = isHit ? "hit" : "miss";
        if (data.runType === t) {
            data.runCount += 1;
        } else {
            if (data.runType !== null) {
                data.series.push({ type: data.runType, count: data.runCount });
            }
            data.runType = t;
            data.runCount = 1;
        }
    }

    #finalizeSeriesCopy(data) {
        const out = [...data.series];
        if (data.runType !== null && data.runCount > 0) {
            out.push({ type: data.runType, count: data.runCount });
        }
        return out;
    }
}
