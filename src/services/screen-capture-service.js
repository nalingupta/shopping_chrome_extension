import { TabManager } from "./screen-capture/tab-manager.js";
import { ScreenshotService } from "./screen-capture/screenshot-service.js";
import { URLMonitor } from "./screen-capture/url-monitor.js";
import { FEATURES } from "../config/features.js";
import { StaticScreenshotService } from "./screen-capture/static-screenshot-service.js";
import { StaticWindowTracker } from "./screen-capture/static-window-tracker.js";

export class ScreenCaptureService {
    constructor() {
        this.urlMonitor = new URLMonitor();
        this.tabManager = new TabManager(this.urlMonitor);
        this.urlMonitor.setTabManager(this.tabManager);
        this.screenshotService = new ScreenshotService(this.tabManager);

        // Static capture stack (independent; legacy TabManager untouched)
        this.staticScreenshotService = new StaticScreenshotService();
        this.staticWindowTracker = new StaticWindowTracker();
    }

    markTabAccessed(tabId) {
        this.tabManager.markTabAccessed(tabId);
    }

    getTabsByUsage(ascending = false) {
        return this.tabManager.getTabsByUsage(ascending);
    }

    async isDebuggerAttached(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return false;
        return this.tabManager.isDebuggerAttached(tabId);
    }

    async setup(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            await this.staticWindowTracker.start();
            return { success: true };
        }
        return this.tabManager.setup(tabId);
    }

    async startRecording() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            return this.staticScreenshotService.startRecording();
        }
        return this.screenshotService.startRecording();
    }

    async captureFrame() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            return this.staticScreenshotService.captureFrame();
        }
        const tabId = this.tabManager.getCurrentTabId();
        return this.screenshotService.captureFrame();
    }

    handleDebuggerEvent(source, method, params) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return;
        this.tabManager.handleDebuggerEvent(source, method, params);
    }

    async handleDebuggerDetach(source, reason) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return { success: true };
        return this.tabManager.handleDebuggerDetach(source, reason);
    }

    async switchToTab(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return { success: true };
        return this.tabManager.switchToTab(tabId);
    }

    async forceCleanupForNewTab(newTabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return { success: true };
        return this.tabManager.forceCleanupForNewTab(newTabId);
    }

    async preAttachToVisibleTabs() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return [];
        return this.tabManager.preAttachToVisibleTabs();
    }

    async stopRecording() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            const res = await this.staticScreenshotService.stopRecording();
            await this.staticWindowTracker.stop();
            return res;
        }
        return this.screenshotService.stopRecording();
    }

    isActive() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            return this.staticScreenshotService.isActive();
        }
        return this.screenshotService.isActive();
    }

    hasStream() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            return this.staticScreenshotService.hasStream();
        }
        return this.screenshotService.hasStream();
    }

    async validateCurrentTab() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return true;
        return this.tabManager.validateCurrentTab();
    }

    cleanupInvalidTab(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return;
        this.tabManager.cleanupInvalidTab(tabId);
    }

    async detachFromTab(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return { success: true };
        return this.tabManager.detachFromTab(tabId);
    }

    async cleanup() {
        try {
            if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
                await this.staticScreenshotService.stopRecording();
                await this.staticWindowTracker.stop();
            } else {
                await this.screenshotService.stopRecording();
                await this.tabManager.cleanup();
            }
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    cleanupDebuggerListeners() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return;
        this.tabManager.cleanupDebuggerListeners();
    }

    async cleanupUnusedAttachments() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return 0;
        return this.tabManager.cleanupUnusedAttachments();
    }

    async validateAttachedTabs() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return 0;
        return this.tabManager.validateAttachedTabs();
    }

    getCurrentTabId() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            const wId = this.staticWindowTracker.getLastFocusedWindowId();
            return wId != null
                ? this.staticWindowTracker.getActiveTabId(wId)
                : null;
        }
        return this.tabManager.getCurrentTabId();
    }

    getAttachedTabs() {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return [];
        return this.tabManager.getAttachedTabs();
    }

    get attachedTabs() {
        return this.tabManager.attachedTabs;
    }

    get monitoredTabs() {
        return this.urlMonitor.monitoredTabs;
    }

    async getTabUrl(tabId) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) {
            try {
                const tab = await chrome.tabs.get(tabId);
                return tab?.url || "unknown";
            } catch (_) {
                return "unknown";
            }
        }
        return this.tabManager.getTabUrl(tabId);
    }

    isRestrictedUrl(url) {
        return this.urlMonitor.isRestrictedUrl(url);
    }

    categorizeFailure(error, tabId) {
        return this.urlMonitor.categorizeFailure(error, tabId);
    }

    isDebuggerConflictError(error) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return false;
        return this.screenshotService.isDebuggerConflictError(error);
    }

    isScreenshotCommandFailure(error) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return false;
        return this.screenshotService.isScreenshotCommandFailure(error);
    }

    async tryStaticFallback(failureType, originalError) {
        if (FEATURES.USE_STATIC_SCREEN_CAPTURE) return null;
        return this.screenshotService.tryStaticFallback(
            failureType,
            originalError
        );
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

    async validateTabEligibility(tabId) {
        return this.tabManager.validateTabEligibility(tabId);
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
