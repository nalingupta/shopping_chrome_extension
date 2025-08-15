import { ScreenCaptureService } from "./screen-capture-service.js";
import { PreviewAdapter } from "./video/preview-adapter.js";
import { SeriesLogger } from "./video/series-logger.js";
import { FrameScheduler } from "./video/frame-scheduler.js";
import { FramePipeline } from "./video/frame-pipeline.js";
import { DEFAULT_CAPTURE_FPS } from "../config/features.js";
import { streamingLogger } from "../utils/streaming-logger.js";

// Facade with the same public API as the old VideoHandler (to avoid import churn)
export class VideoHandler {
    constructor(serverClient, sharedProxy = null) {
        this.serverClient = serverClient;
        this.sharedProxy = sharedProxy; // Phase 5: Port-based media
        this.screenCapture = new ScreenCaptureService();
        this.preview = new PreviewAdapter();
        this.series = new SeriesLogger();
        this.scheduler = null;
        this.pipeline = new FramePipeline({
            serverClient: this.serverClient,
            screenCapture: this.screenCapture,
            seriesLogger: this.series,
            preview: this.preview,
        });
        this.videoStreamingStarted = false;
        this._currentCaptureFps = null;
        this._captureStartWallMs = null;
        this.isTabSwitching = false;
        this._isOwner = false;
        this._mode = "idle"; // idle only in Phase 5
    }

    async setupScreenCapture() {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (!tabs.length) throw new Error("No active tab found");
        const setupResult = await this.screenCapture.setup(tabs[0].id);
        if (!setupResult.success)
            throw new Error(
                setupResult.error || "Failed to setup screen capture"
            );
        const rec = await this.screenCapture.startRecording();
        if (!rec?.success)
            throw new Error(
                rec?.error || "Failed to start static screen capture"
            );
        this.startScreenshotStreaming();
        return { success: true };
    }

    setupTabSwitching() {
        // Keep existing listeners minimal; rely on ScreenCaptureService for switching
        this.tabListeners = {
            onActivated: async () => {
                this.isTabSwitching = true;
                this.videoStreamingStarted = false;
                this.isTabSwitching = false;
            },
        };
        chrome.tabs.onActivated.addListener(this.tabListeners.onActivated);
    }

    cleanupTabListeners() {
        if (this.tabListeners) {
            chrome.tabs.onActivated.removeListener(
                this.tabListeners.onActivated
            );
            this.tabListeners = null;
        }
    }

    startScreenshotStreaming() {
        if (!this._isOwner) return; // owner-only in Phase 5/7
        if (
            !this.screenCapture.hasStream() ||
            !(
                this.serverClient?.isConnectionActive?.() ||
                this.sharedProxy?.isConnectionActive?.()
            )
        )
            return;
        // Mode-based FPS (idle 0.2, active 1.0; prefer server config via proxy)
        const activeFps = this.sharedProxy?.getActiveFps?.() ?? 1.0;
        const idleFps = this.sharedProxy?.getIdleFps?.() ?? 0.2;
        const captureFps = this._mode === "active" ? activeFps : idleFps;
        const intervalMs = Math.max(10, Math.floor(1000 / captureFps));
        this._currentCaptureFps = captureFps;
        this.preview.setFps(captureFps);
        this.preview.startPreview();
        streamingLogger.logInfo(
            `📹 Video stream started (owner-only); mode=${this._mode} captureFps=${captureFps}`
        );
        this._captureStartWallMs = Date.now();
        this.pipeline.setCaptureStart(this._captureStartWallMs);
        this.scheduler = new FrameScheduler(intervalMs);
        this.scheduler.start(async () => {
            const nowPerf = performance?.now?.() || Date.now();
            const { gap, expectedIndex } = this.scheduler.computeGap(nowPerf);
            if (this.scheduler.shouldSkipNext()) {
                this.series.note("miss");
                this.series.noteSegment("miss");
                this.scheduler.advanceExpected(1);
                return;
            }
            for (let i = 0; i < gap; i++) {
                await this.series.ensureSegment(
                    this.screenCapture.getCurrentTabId(),
                    (id) => chrome.tabs.get(id)
                );
                this.series.note("miss");
                this.series.noteSegment("miss");
            }
            const { advanced } = await this._tickOwnerMode();
            this.scheduler._expectedTickIndex = expectedIndex + (advanced || 1);
        });
    }

    async _tickOwnerMode() {
        if (!this.screenCapture.hasStream()) return { advanced: 1 };
        const currentIdBefore = this.screenCapture.getCurrentTabId();
        await this.series.ensureSegment(currentIdBefore, (id) =>
            chrome.tabs.get(id)
        );
        try {
            const frameData = await this.screenCapture.captureFrame();
            const currentIdAfter = this.screenCapture.getCurrentTabId();
            if (currentIdAfter !== currentIdBefore) {
                this.series.note("miss");
                this.series.noteSegment("miss");
                return { advanced: 1 };
            }
            const epoch = this.sharedProxy?.getSessionEpochMs?.() ?? null;
            const tsMs = epoch != null ? Date.now() - epoch : Date.now();
            if (this.sharedProxy?.isConnectionActive?.()) {
                this.sharedProxy.sendImageFrame(frameData, tsMs);
            }
            this.preview.updatePreview(frameData);
            this.series.note("hit");
            this.series.noteSegment("hit");
            return { advanced: 1 };
        } catch (error) {
            const msg = String(error?.message || "");
            const isStaticSkip =
                msg.includes("restricted_or_blocked") ||
                msg.includes("window_minimized_or_unfocused") ||
                msg.includes("no_active_tab");
            const isRateOrBackoff =
                msg.includes("rate_limited") || msg.includes("static_backoff");
            if (isStaticSkip) {
                // No white-frame substitution in owner-only mode
                this.series.note("miss");
                this.series.noteSegment("miss");
                return { advanced: 1 };
            }
            this.series.note("miss");
            this.series.noteSegment("miss");
            return { advanced: 1 };
        }
    }

    applyServerCaptureFps(_newFps) {
        // Handled by setMode which restarts scheduler with new fps
    }

    stopScreenshotStreaming() {
        if (this.scheduler) {
            this.scheduler.stop();
            this.scheduler = null;
        }
        if (this.screenCapture.isActive()) this.screenCapture.stopRecording();
        this.preview.stopPreview();
        const duration =
            this._captureStartWallMs != null
                ? Math.max(0, Date.now() - this._captureStartWallMs)
                : undefined;
        this.series.emitAndReset(this._currentCaptureFps, duration);
        streamingLogger.logInfo("📹 Video stream stopped");
    }

    async cleanup() {
        await this.screenCapture.cleanup();
        this.cleanupTabListeners();
    }

    setVideoStreamingStarted(started) {
        this.videoStreamingStarted = started;
    }
    isVideoStreamingStarted() {
        return this.videoStreamingStarted;
    }

    setOwner(isOwner) {
        if (this._isOwner === !!isOwner) return;
        this._isOwner = !!isOwner;
        if (this._isOwner) {
            // became owner
            this.preview.setNonOwnerBannerVisible(false);
            this.setupScreenCapture().catch(() => {});
        } else {
            // lost ownership
            this.stopScreenshotStreaming();
            this.cleanup().catch(() => {});
            this.preview.setNonOwnerBannerVisible(true);
        }
    }

    setMode(mode) {
        const m = mode === "active" ? "active" : "idle";
        if (this._mode === m && this.scheduler) return;
        this._mode = m;
        if (this._isOwner) {
            this.stopScreenshotStreaming();
            this.startScreenshotStreaming();
        }
    }
}
