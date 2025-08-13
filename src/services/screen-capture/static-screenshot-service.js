export class StaticScreenshotService {
    constructor() {
        this.isRecording = false;
        this.lastBackoffUntilMs = 0;
        this._cachedIncognitoAllowed = null;
        this._cachedFileSchemeAllowed = null;
    }

    async startRecording() {
        try {
            this.isRecording = true;
            await this.#primePermissionsCache();
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error?.message || "Failed to start static capture",
            };
        }
    }

    async captureFrame() {
        if (!this.isRecording) {
            throw new Error("static_capture_inactive");
        }

        const now = Date.now();
        if (now < this.lastBackoffUntilMs) {
            throw new Error("static_backoff");
        }

        const lastFocused = await this.#getLastFocusedWindowSafe();
        if (!lastFocused || lastFocused.state === "minimized") {
            throw new Error("window_minimized_or_unfocused");
        }

        const activeTab = await this.#getActiveTabInWindow(lastFocused.id);
        if (!activeTab) {
            throw new Error("no_active_tab");
        }

        const url = activeTab.url || "";
        const isIncognito = !!activeTab.incognito;

        if (await this.#isRestrictedOrBlocked(url, isIncognito)) {
            throw new Error("restricted_or_blocked");
        }

        try {
            const dataUrl = await chrome.tabs.captureVisibleTab(
                lastFocused.id,
                {
                    format: "jpeg",
                    quality: 80,
                }
            );

            // Some platforms may return undefined with lastError set
            if (!dataUrl || typeof dataUrl !== "string") {
                const errMsg =
                    chrome.runtime?.lastError?.message ||
                    "unknown_capture_error";
                this.#maybeApplyBackoff(errMsg);
                throw new Error(this.#mapErrorToCode(errMsg));
            }

            if (chrome.runtime?.lastError?.message) {
                const errMsg = chrome.runtime.lastError.message;
                this.#maybeApplyBackoff(errMsg);
                throw new Error(this.#mapErrorToCode(errMsg));
            }

            return this.#stripDataUrl(dataUrl);
        } catch (error) {
            const msg = String(
                error?.message || error || "unknown_capture_error"
            );
            this.#maybeApplyBackoff(msg);
            if (
                msg.includes("rate") ||
                msg.includes("too many") ||
                msg.includes("quota")
            ) {
                console.warn(
                    "Static capture skipped due to Chrome FPS/rate limit; will retry next tick"
                );
            }
            throw new Error(this.#mapErrorToCode(msg));
        }
    }

    async stopRecording() {
        try {
            this.isRecording = false;
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error?.message || "Failed to stop static capture",
            };
        }
    }

    isActive() {
        return this.isRecording === true;
    }

    hasStream() {
        // For static capture, do not gate streaming at the service level.
        // The caller should attempt each tick and handle skip conditions.
        return true;
    }

    // --- Internals ---

    async #primePermissionsCache() {
        try {
            if (this._cachedIncognitoAllowed === null) {
                this._cachedIncognitoAllowed = await new Promise((resolve) => {
                    if (!chrome.extension?.isAllowedIncognitoAccess)
                        return resolve(false);
                    chrome.extension.isAllowedIncognitoAccess((allowed) =>
                        resolve(!!allowed)
                    );
                });
            }
        } catch (_) {
            this._cachedIncognitoAllowed = false;
        }

        try {
            if (this._cachedFileSchemeAllowed === null) {
                this._cachedFileSchemeAllowed = await new Promise((resolve) => {
                    if (!chrome.extension?.isAllowedFileSchemeAccess)
                        return resolve(false);
                    chrome.extension.isAllowedFileSchemeAccess((allowed) =>
                        resolve(!!allowed)
                    );
                });
            }
        } catch (_) {
            this._cachedFileSchemeAllowed = false;
        }
    }

    async #getLastFocusedWindowSafe() {
        try {
            // Prefer a focused normal browser window. If none, pick any normal window.
            const wins = await chrome.windows.getAll({
                populate: false,
                windowTypes: ["normal"],
            });
            if (Array.isArray(wins) && wins.length > 0) {
                const focused = wins.find((w) => w.focused);
                return focused || wins[0];
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    async #getActiveTabInWindow(windowId) {
        try {
            const tabs = await chrome.tabs.query({ active: true, windowId });
            return Array.isArray(tabs) && tabs.length ? tabs[0] : null;
        } catch (_) {
            return null;
        }
    }

    async #isRestrictedOrBlocked(url, isIncognito) {
        const u = String(url || "");
        const isFile = u.startsWith("file://");
        const isChromeScheme =
            u.startsWith("chrome://") ||
            u.startsWith("chrome-extension://") ||
            u.startsWith("edge://") ||
            u.startsWith("about:");
        if (isChromeScheme) return true;

        if (this.#isChromeWebStoreUrl(u)) return true;

        if (isIncognito && this._cachedIncognitoAllowed === false) return true;

        if (isFile && this._cachedFileSchemeAllowed === false) return true;

        return false;
    }

    #isChromeWebStoreUrl(url) {
        try {
            const { host } = new URL(url);
            return (
                host === "chromewebstore.google.com" ||
                (host === "chrome.google.com" && url.includes("/webstore"))
            );
        } catch (_) {
            return false;
        }
    }

    #stripDataUrl(dataUrl) {
        const i = dataUrl.indexOf(",");
        if (i >= 0) return dataUrl.slice(i + 1);
        return dataUrl;
    }

    #maybeApplyBackoff(message) {
        const lower = String(message || "").toLowerCase();
        if (
            lower.includes("rate") ||
            lower.includes("too many") ||
            lower.includes("quota") ||
            lower.includes("permission")
        ) {
            const now = Date.now();
            const backoffMs = 1500;
            this.lastBackoffUntilMs = Math.max(
                this.lastBackoffUntilMs,
                now + backoffMs
            );
        }
    }

    #mapErrorToCode(message) {
        const lower = String(message || "").toLowerCase();
        if (
            lower.includes("rate") ||
            lower.includes("too many") ||
            lower.includes("quota")
        ) {
            return "rate_limited";
        }
        if (lower.includes("permission")) {
            return "permission_denied";
        }
        if (lower.includes("restricted") || lower.includes("blocked")) {
            return "restricted_or_blocked";
        }
        if (lower.includes("minimized") || lower.includes("focus")) {
            return "window_minimized_or_unfocused";
        }
        return lower || "unknown_capture_error";
    }
}
