// Per-tick capture pipeline
export class FramePipeline {
    constructor({ serverClient, screenCapture, seriesLogger, preview }) {
        this.serverClient = serverClient;
        this.screenCapture = screenCapture;
        this.series = seriesLogger;
        this.preview = preview;
        this._firstFrameDims = null; // { width, height }
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
            // Phase 5: sending to server is handled by VideoHandler when owner via sharedProxy.
            // FramePipeline only updates preview and series here to avoid double-sends.
            this.preview.updatePreview(frameData);
            // Capture first frame dimensions asynchronously for future white-frame substitution
            this._maybeCaptureFirstDimsAsync(frameData);
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
                // Try to substitute with a white frame if we know frame dimensions
                if (this._firstFrameDims) {
                    const whiteBase64 = await this._ensureWhiteFrameBase64();
                    if (whiteBase64) {
                        this.preview.updatePreview(whiteBase64);
                        this.series.note("substitute");
                        this.series.noteSegment("substitute");
                        return { advanced: 1 };
                    }
                }
                // If we couldn't substitute, count as miss
                this.series.note("miss");
                this.series.noteSegment("miss");
                return { advanced: 1 };
            }
            // Rate/backoff or other errors → miss
            this.series.note("miss");
            this.series.noteSegment("miss");
            return { advanced: 1 };
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
                    // Invalidate cached white frame if any
                    this._whiteFrameBase64 = null;
                    // Pre-warm white frame asynchronously
                    try {
                        setTimeout(() => {
                            Promise.resolve(
                                this._ensureWhiteFrameBase64()
                            ).catch(() => {});
                        }, 0);
                    } catch (_) {}
                }
            };
            img.onerror = () => {};
            img.src = `data:image/jpeg;base64,${base64Jpeg}`;
        } catch (_) {}
    }

    async _ensureWhiteFrameBase64() {
        if (this._whiteFrameBase64) return this._whiteFrameBase64;
        const dims = this._firstFrameDims;
        if (!dims || !dims.width || !dims.height) return null;
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
                this._whiteFrameBase64 = base64;
                return base64;
            }
            return null;
        } catch (_) {
            return null;
        }
    }
}
