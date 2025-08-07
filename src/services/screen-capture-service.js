import { TabManager } from "./screen-capture/tab-manager.js";
import { ScreenshotService } from "./screen-capture/screenshot-service.js";

export class ScreenCaptureService {
    constructor() {
        this.tabManager = new TabManager();
        this.screenshotService = new ScreenshotService(this.tabManager);
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
        return this.screenshotService.startRecording();
    }

    async captureFrame() {
        return this.screenshotService.captureFrame();
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
        return this.screenshotService.stopRecording();
    }

    isActive() {
        return this.screenshotService.isActive();
    }

    hasStream() {
        return this.screenshotService.hasStream();
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
            await this.screenshotService.stopRecording();
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
        return this.screenshotService.isDebuggerConflictError(error);
    }

    isScreenshotCommandFailure(error) {
        return this.screenshotService.isScreenshotCommandFailure(error);
    }

    async tryStaticFallback(failureType, originalError) {
        return this.screenshotService.tryStaticFallback(
            failureType,
            originalError
        );
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
