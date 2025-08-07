import { TabManager } from "./screen-capture/tab-manager.js";

export class ScreenCaptureService {
    constructor() {
        this.tabManager = new TabManager();
        this.isRecording = false;
    }

    markTabAccessed(tabId) {
        this.tabManager.markTabAccessed(tabId);
    }

    getTabsByUsage(ascending = false) {
        return this.tabManager.getTabsByUsage(ascending);
    }

    async isDebuggerAttached(tabId) {
        return this.tabManager.isDebuggerAttached(tabId);
    }

    async setup(tabId) {
        return this.tabManager.setup(tabId);
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

        if (!(await this.validateCurrentTab())) {
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

    handleDebuggerEvent(source, method, params) {
        this.tabManager.handleDebuggerEvent(source, method, params);
    }

    async handleDebuggerDetach(source, reason) {
        return this.tabManager.handleDebuggerDetach(source, reason);
    }

    async switchToTab(tabId) {
        return this.tabManager.switchToTab(tabId);
    }

    async forceCleanupForNewTab(newTabId) {
        return this.tabManager.forceCleanupForNewTab(newTabId);
    }

    async preAttachToVisibleTabs() {
        return this.tabManager.preAttachToVisibleTabs();
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

    async validateCurrentTab() {
        return this.tabManager.validateCurrentTab();
    }

    cleanupInvalidTab(tabId) {
        this.tabManager.cleanupInvalidTab(tabId);
    }

    async detachFromTab(tabId) {
        return this.tabManager.detachFromTab(tabId);
    }

    async cleanup() {
        try {
            await this.stopRecording();
            await this.tabManager.cleanup();
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    cleanupDebuggerListeners() {
        this.tabManager.cleanupDebuggerListeners();
    }

    async cleanupUnusedAttachments() {
        return this.tabManager.cleanupUnusedAttachments();
    }

    async validateAttachedTabs() {
        return this.tabManager.validateAttachedTabs();
    }

    getCurrentTabId() {
        return this.tabManager.getCurrentTabId();
    }

    getAttachedTabs() {
        return this.tabManager.getAttachedTabs();
    }

    get attachedTabs() {
        return this.tabManager.attachedTabs;
    }

    async getTabUrl(tabId) {
        return this.tabManager.getTabUrl(tabId);
    }

    isRestrictedUrl(url) {
        return this.tabManager.isRestrictedUrl(url);
    }

    categorizeFailure(error, tabId) {
        return this.tabManager.categorizeFailure(error, tabId);
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

    incrementFailureCount(tabId, failureType) {
        this.tabManager.incrementFailureCount(tabId, failureType);
    }

    getFailureCount(tabId, failureType) {
        return this.tabManager.getFailureCount(tabId, failureType);
    }

    resetFailureCount(tabId, failureType) {
        this.tabManager.resetFailureCount(tabId, failureType);
    }

    async validateTabEligibility(tabId) {
        return this.tabManager.validateTabEligibility(tabId);
    }

    startUrlMonitoring(tabId, title) {
        this.tabManager.startUrlMonitoring(tabId, title);
    }

    stopUrlMonitoring(tabId) {
        this.tabManager.stopUrlMonitoring(tabId);
    }

    async checkTabUrl(tabId) {
        return this.tabManager.checkTabUrl(tabId);
    }

    cleanupMonitoring() {
        this.tabManager.cleanupMonitoring();
    }
}
