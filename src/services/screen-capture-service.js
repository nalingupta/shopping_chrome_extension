import { URLMonitor } from "./screen-capture/url-monitor.js";
import { FEATURES } from "../config/features.js";
import { StaticScreenshotService } from "./screen-capture/static-screenshot-service.js";
import { StaticWindowTracker } from "./screen-capture/static-window-tracker.js";

export class ScreenCaptureService {
    constructor() {
        this.urlMonitor = new URLMonitor();
        // Debugger-based capture removed; static capture only
        this.tabManager = null;
        this.urlMonitor.setTabManager?.(null);
        this.screenshotService = null;

        // Static capture stack (independent; legacy TabManager untouched)
        this.staticScreenshotService = new StaticScreenshotService();
        this.staticWindowTracker = new StaticWindowTracker();
    }

    markTabAccessed(_tabId) {
        // No-op in static-only capture mode
    }

    getTabsByUsage(_ascending = false) {
        // Not applicable in static-only capture mode
        return [];
    }

    async isDebuggerAttached(_tabId) {
        return false;
    }

    async setup(tabId) {
        await this.staticWindowTracker.start();
        return { success: true };
    }

    async startRecording() {
        return this.staticScreenshotService.startRecording();
    }

    async captureFrame() {
        return this.staticScreenshotService.captureFrame();
    }

    handleDebuggerEvent(source, method, params) {
        return;
    }

    async handleDebuggerDetach(source, reason) {
        return { success: true };
    }

    async switchToTab(tabId) {
        return { success: true };
    }

    async forceCleanupForNewTab(newTabId) {
        return { success: true };
    }

    async preAttachToVisibleTabs() {
        return [];
    }

    async stopRecording() {
        const res = await this.staticScreenshotService.stopRecording();
        await this.staticWindowTracker.stop();
        return res;
    }

    isActive() {
        return this.staticScreenshotService.isActive();
    }

    hasStream() {
        return this.staticScreenshotService.hasStream();
    }

    async validateCurrentTab() {
        return true;
    }

    cleanupInvalidTab(tabId) {
        return;
    }

    async detachFromTab(tabId) {
        return { success: true };
    }

    async cleanup() {
        try {
            await this.staticScreenshotService.stopRecording();
            await this.staticWindowTracker.stop();
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    cleanupDebuggerListeners() {
        return;
    }

    async cleanupUnusedAttachments() {
        return 0;
    }

    async validateAttachedTabs() {
        return 0;
    }

    getCurrentTabId() {
        const wId = this.staticWindowTracker.getLastFocusedWindowId();
        return wId != null
            ? this.staticWindowTracker.getActiveTabId(wId)
            : null;
    }

    getAttachedTabs() {
        return [];
    }

    get attachedTabs() {
        return new Map();
    }

    get monitoredTabs() {
        return this.urlMonitor.monitoredTabs;
    }

    async getTabUrl(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            return tab?.url || "unknown";
        } catch (_) {
            return "unknown";
        }
    }

    isRestrictedUrl(url) {
        return this.urlMonitor.isRestrictedUrl(url);
    }

    categorizeFailure(error, tabId) {
        return this.urlMonitor.categorizeFailure(error, tabId);
    }

    isDebuggerConflictError(error) {
        return false;
    }

    isScreenshotCommandFailure(error) {
        return false;
    }

    async tryStaticFallback(failureType, originalError) {
        return null;
    }

    incrementFailureCount(tabId, failureType) {
        this.urlMonitor.incrementFailureCount(tabId, failureType);
    }

    getFailureCount(tabId, failureType) {
        return this.urlMonitor.getFailureCount(tabId, failureType);
    }

    resetFailureCount(tabId, failureType) {
        this.urlMonitor.resetFailureCount(tabId, failureType);
    }

    async validateTabEligibility(_tabId) {
        return { eligible: true };
    }

    startUrlMonitoring(tabId, title) {
        this.urlMonitor.startUrlMonitoring(tabId, title);
    }

    stopUrlMonitoring(tabId) {
        this.urlMonitor.stopUrlMonitoring(tabId);
    }

    async checkTabUrl(tabId) {
        return this.urlMonitor.checkTabUrl(tabId);
    }

    cleanupMonitoring() {
        this.urlMonitor.cleanupMonitoring();
    }
}
