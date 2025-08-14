// Per-tick capture pipeline
export class FramePipeline {
    constructor({ aiHandler, screenCapture, seriesLogger, preview }) {
        this.aiHandler = aiHandler;
        this.screenCapture = screenCapture;
        this.series = seriesLogger;
        this.preview = preview;
        this._firstFrameDimsCaptured = false;
        this._whiteFrameBase64 = null;
        this._captureStartWallMs = null;
        this._currentTabId = null;
    }

    setCaptureStart(nowMs) {
        this._captureStartWallMs = nowMs;
    }

    async tick() {
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
            const sessionStart = this.aiHandler.getSessionStartMs?.() || null;
            const tsMs = sessionStart
                ? (performance?.now?.() || Date.now()) - sessionStart
                : performance?.now?.() || Date.now();
            if (this.aiHandler.isConnectionActive()) {
                this.aiHandler.sendImageFrame(frameData, tsMs);
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
                this.series.note("substitute");
                this.series.noteSegment("substitute");
            } else {
                this.series.note("miss");
                this.series.noteSegment("miss");
            }
            return { advanced: 1 };
        }
    }
}
