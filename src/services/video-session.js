import { ScreenCaptureService } from "./screen-capture-service.js";
import { PreviewAdapter } from "./video/preview-adapter.js";
import { SeriesLogger } from "./video/series-logger.js";
import { FrameScheduler } from "./video/frame-scheduler.js";
import { FramePipeline } from "./video/frame-pipeline.js";
import { DEFAULT_CAPTURE_FPS } from "../config/features.js";
import { streamingLogger } from "../utils/streaming-logger.js";

// Facade with the same public API as the old VideoHandler (to avoid import churn)
export class VideoHandler {
    constructor(serverClient) {
        this.aiHandler = serverClient;
        this.screenCapture = new ScreenCaptureService();
        this.preview = new PreviewAdapter();
        this.series = new SeriesLogger();
        this.scheduler = null;
        this.pipeline = new FramePipeline({
            aiHandler,
            screenCapture: this.screenCapture,
            seriesLogger: this.series,
            preview: this.preview,
        });
        this.videoStreamingStarted = false;
        this._currentCaptureFps = null;
        this._captureStartWallMs = null;
        this.isTabSwitching = false;
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
        if (
            !this.screenCapture.hasStream() ||
            !this.aiHandler.isConnectionActive()
        )
            return;
        const backendFps = this.aiHandler?.serverAPI?.getCaptureFps?.();
        const captureFps =
            typeof backendFps === "number" && backendFps > 0
                ? backendFps
                : DEFAULT_CAPTURE_FPS;
        const intervalMs = Math.max(10, Math.floor(1000 / captureFps));
        this._currentCaptureFps = captureFps;
        this.preview.setFps(captureFps);
        this.preview.startPreview();
        streamingLogger.logInfo(
            `📹 Video stream started (continuous); captureFps=${captureFps}`
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
            const { advanced } = await this.pipeline.tick();
            this.scheduler._expectedTickIndex = expectedIndex + (advanced || 1);
        });
    }

    applyServerCaptureFps(newFps) {
        const n = Number(newFps);
        if (!Number.isFinite(n) || n <= 0) return;
        if (this._currentCaptureFps && this._currentCaptureFps === n) return;
        const wasActive = !!this.scheduler;
        if (wasActive) {
            this.stopScreenshotStreaming();
            this.startScreenshotStreaming();
        }
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
}
