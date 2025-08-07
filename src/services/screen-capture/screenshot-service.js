export class ScreenshotService {
    constructor(tabManager) {
        this.tabManager = tabManager;
        this.isRecording = false;
    }

    async startRecording() {
        if (
            !this.tabManager.getCurrentTabId() ||
            !this.tabManager
                .getAttachedTabs()
                .includes(this.tabManager.getCurrentTabId())
        ) {
            throw new Error("Debugger not attached to current tab");
        }

        try {
            this.isRecording = true;
            return { success: true };
        } catch (error) {
            console.error("Failed to start recording:", error);
            return {
                success: false,
                error: error.message || "Unknown recording error",
            };
        }
    }

    async captureFrame() {
        if (
            !this.tabManager.getCurrentTabId() ||
            !this.tabManager
                .getAttachedTabs()
                .includes(this.tabManager.getCurrentTabId())
        ) {
            throw new Error("Debugger not attached to current tab");
        }

        if (!(await this.tabManager.validateCurrentTab())) {
            throw new Error("Current tab is not valid for capture");
        }

        try {
            const result = await chrome.debugger.sendCommand(
                { tabId: this.tabManager.getCurrentTabId() },
                "Page.captureScreenshot",
                {
                    format: "jpeg",
                    quality: 80,
                    clip: null,
                    fromSurface: true,
                }
            );

            if (result && result.data) {
                return result.data;
            } else {
                throw new Error("No screenshot data received");
            }
        } catch (error) {
            if (this.isDebuggerConflictError(error)) {
                return await this.tryStaticFallback("debugger conflict", error);
            } else if (this.isScreenshotCommandFailure(error)) {
                return await this.tryStaticFallback(
                    "screenshot command failure",
                    error
                );
            } else {
                throw new Error(error.message || "Frame capture failed");
            }
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            return { success: true };
        }

        try {
            this.isRecording = false;
            return { success: true };
        } catch (error) {
            console.error("Failed to stop recording:", error);
            return { success: false, error: error.message };
        }
    }

    isActive() {
        return (
            this.isRecording &&
            this.tabManager.getCurrentTabId() &&
            this.tabManager
                .getAttachedTabs()
                .includes(this.tabManager.getCurrentTabId())
        );
    }

    hasStream() {
        return (
            this.tabManager.getCurrentTabId() &&
            this.tabManager
                .getAttachedTabs()
                .includes(this.tabManager.getCurrentTabId())
        );
    }

    isDebuggerConflictError(error) {
        const errorMessage = error.message || error.toString().toLowerCase();
        return (
            errorMessage.includes("already attached") ||
            errorMessage.includes("debugger is already attached") ||
            errorMessage.includes("debugger conflict")
        );
    }

    isScreenshotCommandFailure(error) {
        const errorMessage = error.message || error.toString().toLowerCase();
        return (
            errorMessage.includes("page.capturescreenshot") ||
            errorMessage.includes("screenshot command") ||
            errorMessage.includes("capture command") ||
            errorMessage.includes("protocol error") ||
            errorMessage.includes("command failed")
        );
    }

    async tryStaticFallback(failureType, originalError) {
        try {
            const currentWindow = await chrome.windows.getCurrent();
            const staticCapture = await chrome.tabs.captureVisibleTab(
                currentWindow.id,
                { format: "jpeg", quality: 80 }
            );
            return staticCapture;
        } catch (staticError) {
            console.error("Static fallback failed:", staticError);
            throw new Error(
                `Both capture methods failed: ${failureType} + Static API error`
            );
        }
    }
}
