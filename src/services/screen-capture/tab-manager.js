export class TabManager {
    constructor() {
        this.attachedTabs = new Map(); // Map of tabId -> attachment status
        this.tabUsageHistory = new Map(); // Map of tabId -> last accessed timestamp
        this.currentTabId = null;
        this.isInitialized = false;
        this.isTabSwitchInProgress = false;

        // State management for restricted URL handling
        this.monitoredTabs = new Map(); // Map of tabId -> monitoring info
        this.failureCounts = new Map(); // Map of tabId -> failure count by type
        this.urlMonitoringIntervals = new Map(); // Map of tabId -> interval ID
        this.maxMonitoredTabs = 5;
    }

    markTabAccessed(tabId) {
        this.tabUsageHistory.set(tabId, Date.now());
    }

    getTabsByUsage(ascending = false) {
        return Array.from(this.attachedTabs.keys()).sort((a, b) => {
            const timeA = this.tabUsageHistory.get(a) || 0;
            const timeB = this.tabUsageHistory.get(b) || 0;
            return ascending ? timeA - timeB : timeB - timeA;
        });
    }

    async isDebuggerAttached(tabId) {
        try {
            const targets = await chrome.debugger.getTargets();
            const target = targets.find((t) => t.tabId === tabId);
            return target && target.attached;
        } catch (error) {
            try {
                await chrome.debugger.attach({ tabId }, "1.3");
                await chrome.debugger.detach({ tabId });
                return false;
            } catch (attachError) {
                return true;
            }
        }
    }

    async setup(tabId) {
        try {
            if (this.attachedTabs.has(tabId)) {
                this.currentTabId = tabId;
                return { success: true };
            }

            await chrome.debugger.attach({ tabId }, "1.3");
            await chrome.debugger.sendCommand({ tabId }, "Page.enable");
            await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");

            this.attachedTabs.set(tabId, true);
            this.currentTabId = tabId;

            if (!this.isInitialized) {
                chrome.debugger.onEvent.addListener(
                    this.handleDebuggerEvent.bind(this)
                );
                chrome.debugger.onDetach.addListener((source, reason) =>
                    this.handleDebuggerDetach(source, reason)
                );
                this.isInitialized = true;
            }

            return { success: true };
        } catch (error) {
            console.error("Failed to attach debugger to tab:", tabId, error);
            return {
                success: false,
                error: error.message || "Unknown debugger error",
            };
        }
    }

    handleDebuggerEvent(source, method, params) {
        if (source.tabId !== this.currentTabId) {
            return;
        }

        if (method === "Runtime.exceptionThrown") {
            console.error(
                "Exception thrown in tab",
                this.currentTabId,
                params.exceptionDetails
            );
        }
    }

    async handleDebuggerDetach(source, reason) {
        const tabId = source.tabId;
        console.log("Debugger detached from tab:", tabId, "Reason:", reason);

        this.attachedTabs.delete(tabId);

        if (this.currentTabId === tabId) {
            this.currentTabId = null;
        }

        if (reason === "target_closed") {
            try {
                const [activeTab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });

                if (activeTab) {
                    if (this.attachedTabs.has(activeTab.id)) {
                        this.currentTabId = activeTab.id;
                    } else {
                        const result = await this.setup(activeTab.id);
                        if (result.success) {
                            this.currentTabId = activeTab.id;
                        }
                    }
                }
            } catch (error) {
                console.error("Error during automatic tab attachment:", error);
            }
        }
    }

    async switchToTab(tabId) {
        try {
            if (this.isTabSwitchInProgress) {
                return {
                    success: false,
                    error: "Tab switch already in progress",
                };
            }

            if (this.currentTabId === tabId && this.attachedTabs.has(tabId)) {
                return { success: true };
            }

            const isNewTab = !this.attachedTabs.has(tabId);
            this.isTabSwitchInProgress = true;

            if (!this.attachedTabs.has(tabId)) {
                const maxAttachments = 10;
                if (this.attachedTabs.size >= maxAttachments) {
                    await this.cleanupUnusedAttachments();
                    if (this.attachedTabs.size >= maxAttachments) {
                        await this.forceCleanupForNewTab(tabId);
                    }
                }

                const eligibility = await this.validateTabEligibility(tabId);

                if (!eligibility.eligible) {
                    if (eligibility.reason === "RESTRICTED_URL") {
                        if (this.monitoredTabs.size < this.maxMonitoredTabs) {
                            this.startUrlMonitoring(
                                tabId,
                                eligibility.title || "Unknown"
                            );
                            return {
                                success: true,
                                message:
                                    "Tab is restricted, monitoring for URL change",
                            };
                        } else {
                            return {
                                success: false,
                                error: "Cannot monitor restricted tab - at limit",
                            };
                        }
                    }
                    return {
                        success: false,
                        error: `Tab is not eligible: ${eligibility.reason}`,
                    };
                }

                const result = await this.setup(tabId);
                if (!result.success) {
                    const failureType = this.categorizeFailure(
                        result.error,
                        tabId
                    );
                    this.incrementFailureCount(tabId, failureType);

                    if (failureType === "RESTRICTED_URL") {
                        if (this.monitoredTabs.size < this.maxMonitoredTabs) {
                            this.startUrlMonitoring(
                                tabId,
                                eligibility.title || "Unknown"
                            );
                            return {
                                success: true,
                                message:
                                    "Tab is restricted, monitoring for URL change",
                            };
                        }
                    } else if (failureType === "DEBUGGER_CONFLICT") {
                        return {
                            success: false,
                            error: "Debugger conflict - skipping tab",
                        };
                    } else if (failureType === "NETWORK_ERROR") {
                        const retryCount = this.getFailureCount(
                            tabId,
                            failureType
                        );
                        if (retryCount <= 3) {
                            return {
                                success: false,
                                error: "Network error - will retry",
                            };
                        }
                    }
                    return { success: false, error: result.error };
                }

                this.resetFailureCount(tabId, "RESTRICTED_URL");
                this.resetFailureCount(tabId, "NETWORK_ERROR");
            }

            this.currentTabId = tabId;
            this.markTabAccessed(tabId);

            return { success: true };
        } catch (error) {
            console.error("Failed to switch to tab:", tabId, error);
            return { success: false, error: error.message };
        } finally {
            this.isTabSwitchInProgress = false;
        }
    }

    async forceCleanupForNewTab(newTabId) {
        try {
            const tabsByUsage = this.getTabsByUsage(true);
            const tabToRemove = tabsByUsage
                .filter((tabId) => tabId !== this.currentTabId)
                .shift();

            if (tabToRemove) {
                await this.detachFromTab(tabToRemove);
            }
        } catch (error) {
            console.error("Error during forced cleanup:", error);
        }
    }

    async preAttachToVisibleTabs() {
        try {
            const originalCurrentTabId = this.currentTabId;
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            const attachableTabs = [];
            for (const tab of allTabs) {
                if (this.isRestrictedUrl(tab.url) || tab.active) {
                    continue;
                }

                const isAttached = await this.isDebuggerAttached(tab.id);
                if (isAttached) {
                    continue;
                }

                attachableTabs.push(tab);
            }

            const maxTabs = 10;
            const tabsToAttach = attachableTabs.slice(0, maxTabs);
            tabsToAttach.sort(
                (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
            );

            const results = [];
            for (const tab of tabsToAttach) {
                try {
                    const result = await this.setup(tab.id);
                    results.push({
                        tabId: tab.id,
                        url: tab.url,
                        windowId: tab.windowId,
                        active: tab.active,
                        success: result.success,
                        error: result.error,
                    });
                } catch (error) {
                    results.push({
                        tabId: tab.id,
                        url: tab.url,
                        windowId: tab.windowId,
                        active: tab.active,
                        success: false,
                        error: error.message,
                    });
                }
            }

            this.currentTabId = originalCurrentTabId;
            return results;
        } catch (error) {
            console.error("Failed to pre-attach to visible tabs:", error);
            return [];
        }
    }

    async validateCurrentTab() {
        if (!this.currentTabId) {
            return false;
        }

        try {
            const tab = await chrome.tabs.get(this.currentTabId);

            if (!tab || this.isRestrictedUrl(tab.url)) {
                this.cleanupInvalidTab(this.currentTabId);
                return false;
            }

            return true;
        } catch (error) {
            this.cleanupInvalidTab(this.currentTabId);
            return false;
        }
    }

    cleanupInvalidTab(tabId) {
        this.attachedTabs.delete(tabId);
        if (this.currentTabId === tabId) {
            this.currentTabId = null;
        }
    }

    async detachFromTab(tabId) {
        try {
            if (this.attachedTabs.has(tabId)) {
                try {
                    await chrome.tabs.get(tabId);
                } catch (error) {
                    this.attachedTabs.delete(tabId);
                    if (this.currentTabId === tabId) {
                        this.currentTabId = null;
                    }
                    return { success: true };
                }

                await chrome.debugger.detach({ tabId });
                this.attachedTabs.delete(tabId);

                if (this.currentTabId === tabId) {
                    this.currentTabId = null;
                }

                return { success: true };
            }
            return { success: true };
        } catch (error) {
            console.error("Failed to detach from tab:", tabId, error);
            this.attachedTabs.delete(tabId);
            if (this.currentTabId === tabId) {
                this.currentTabId = null;
            }
            return { success: false, error: error.message };
        }
    }

    async cleanup() {
        try {
            if (this.attachedTabs.size === 0) {
                return;
            }

            const allTabs = await chrome.tabs.query({});
            const openTabIds = new Set(allTabs.map((tab) => tab.id));

            const tabIds = Array.from(this.attachedTabs.keys());
            for (const tabId of tabIds) {
                if (!openTabIds.has(tabId)) {
                    continue;
                }

                try {
                    await chrome.debugger.detach({ tabId });
                } catch (error) {
                    console.error("Failed to detach from tab:", tabId, error);
                }
            }

            this.cleanupDebuggerListeners();
            this.cleanupMonitoring();

            this.attachedTabs.clear();
            this.currentTabId = null;
            this.isInitialized = false;
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    cleanupDebuggerListeners() {
        if (this.isInitialized) {
            try {
                chrome.debugger.onEvent.removeListener(
                    this.handleDebuggerEvent.bind(this)
                );
                chrome.debugger.onDetach.removeListener((source, reason) =>
                    this.handleDebuggerDetach(source, reason)
                );
                this.isInitialized = false;
            } catch (error) {
                console.error("Error cleaning up debugger listeners:", error);
            }
        }
    }

    async cleanupUnusedAttachments() {
        try {
            await this.validateAttachedTabs();

            const allTabs = await chrome.tabs.query({});
            const openTabIds = new Set(allTabs.map((tab) => tab.id));

            const tabsToDetach = [];
            for (const [tabId] of this.attachedTabs) {
                if (!openTabIds.has(tabId)) {
                    tabsToDetach.push(tabId);
                }
            }

            for (const tabId of tabsToDetach) {
                try {
                    await this.detachFromTab(tabId);
                } catch (error) {
                    console.error(
                        "Failed to cleanup attachment to tab:",
                        tabId,
                        error
                    );
                }
            }

            const maxAttachments = 10;
            if (this.attachedTabs.size > maxAttachments) {
                const attachedTabIds = Array.from(this.attachedTabs.keys());
                const tabsToKeep = [this.currentTabId];

                const recentTabs = this.getTabsByUsage(false)
                    .filter((tabId) => tabId !== this.currentTabId)
                    .slice(0, maxAttachments - 1);

                tabsToKeep.push(...recentTabs);

                const tabsToRemove = attachedTabIds.filter(
                    (tabId) => !tabsToKeep.includes(tabId)
                );

                for (const tabId of tabsToRemove) {
                    try {
                        await this.detachFromTab(tabId);
                    } catch (error) {
                        console.error(
                            "Failed to remove excess attachment to tab:",
                            tabId,
                            error
                        );
                    }
                }
            }
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    async validateAttachedTabs() {
        try {
            const tabsToDetach = [];

            for (const [tabId] of this.attachedTabs) {
                try {
                    const tab = await chrome.tabs.get(tabId);
                    if (this.isRestrictedUrl(tab.url)) {
                        tabsToDetach.push(tabId);
                    }
                } catch (error) {
                    tabsToDetach.push(tabId);
                }
            }

            for (const tabId of tabsToDetach) {
                try {
                    await this.detachFromTab(tabId);
                } catch (error) {
                    console.error(
                        "Failed to detach from invalid tab:",
                        tabId,
                        error
                    );
                }
            }

            return tabsToDetach.length;
        } catch (error) {
            console.error("Error during tab validation:", error);
            return 0;
        }
    }

    getCurrentTabId() {
        return this.currentTabId;
    }

    getAttachedTabs() {
        return Array.from(this.attachedTabs.keys());
    }

    async getTabUrl(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);
            return tab.url;
        } catch (error) {
            return "unknown";
        }
    }

    isRestrictedUrl(url) {
        return (
            url.startsWith("chrome://") ||
            url.startsWith("chrome-extension://") ||
            url.startsWith("moz-extension://") ||
            url.startsWith("edge://") ||
            url.startsWith("about:")
        );
    }

    categorizeFailure(error, tabId) {
        const errorMessage = error.message || error.toString();

        if (
            errorMessage.includes("restricted") ||
            errorMessage.includes("chrome://") ||
            errorMessage.includes("chrome-extension://")
        ) {
            return "RESTRICTED_URL";
        } else if (
            errorMessage.includes("already attached") ||
            errorMessage.includes("Debugger is already attached")
        ) {
            return "DEBUGGER_CONFLICT";
        } else if (
            errorMessage.includes("network") ||
            errorMessage.includes("timeout") ||
            errorMessage.includes("connection")
        ) {
            return "NETWORK_ERROR";
        } else if (
            errorMessage.includes("permission") ||
            errorMessage.includes("denied")
        ) {
            return "PERMISSION_DENIED";
        } else {
            return "UNKNOWN_ERROR";
        }
    }

    async validateTabEligibility(tabId) {
        try {
            const tab = await chrome.tabs.get(tabId);

            if (this.isRestrictedUrl(tab.url)) {
                return {
                    eligible: false,
                    reason: "RESTRICTED_URL",
                    url: tab.url,
                    title: tab.title,
                };
            }

            const isAttached = await this.isDebuggerAttached(tabId);
            if (isAttached) {
                return {
                    eligible: false,
                    reason: "DEBUGGER_CONFLICT",
                    url: tab.url,
                    title: tab.title,
                };
            }

            return {
                eligible: true,
                url: tab.url,
                title: tab.title,
            };
        } catch (error) {
            return {
                eligible: false,
                reason: "TAB_NOT_FOUND",
                error: error.message,
            };
        }
    }

    startUrlMonitoring(tabId, title) {
        this.stopUrlMonitoring(tabId);

        this.monitoredTabs.set(tabId, {
            startTime: Date.now(),
            title: title,
            lastCheck: Date.now(),
        });

        const intervalId = setInterval(async () => {
            await this.checkTabUrl(tabId);
        }, 1000);

        this.urlMonitoringIntervals.set(tabId, intervalId);

        setTimeout(() => {
            this.stopUrlMonitoring(tabId);
        }, 30000);
    }

    stopUrlMonitoring(tabId) {
        const intervalId = this.urlMonitoringIntervals.get(tabId);
        if (intervalId) {
            clearInterval(intervalId);
            this.urlMonitoringIntervals.delete(tabId);
        }
        this.monitoredTabs.delete(tabId);
    }

    async checkTabUrl(tabId) {
        try {
            const monitoringInfo = this.monitoredTabs.get(tabId);
            if (!monitoringInfo) {
                return;
            }

            const tab = await chrome.tabs.get(tabId);
            monitoringInfo.lastCheck = Date.now();

            if (!this.isRestrictedUrl(tab.url)) {
                this.stopUrlMonitoring(tabId);

                const result = await this.setup(tabId);
                if (result.success) {
                    this.resetFailureCount(tabId, "RESTRICTED_URL");
                }
            }
        } catch (error) {
            this.stopUrlMonitoring(tabId);
        }
    }

    cleanupMonitoring() {
        for (const [tabId, intervalId] of this.urlMonitoringIntervals) {
            clearInterval(intervalId);
        }
        this.urlMonitoringIntervals.clear();
        this.monitoredTabs.clear();
        this.failureCounts.clear();
    }

    incrementFailureCount(tabId, failureType) {
        if (!this.failureCounts.has(tabId)) {
            this.failureCounts.set(tabId, new Map());
        }
        const tabFailures = this.failureCounts.get(tabId);
        tabFailures.set(failureType, (tabFailures.get(failureType) || 0) + 1);
    }

    getFailureCount(tabId, failureType) {
        const tabFailures = this.failureCounts.get(tabId);
        return tabFailures ? tabFailures.get(failureType) || 0 : 0;
    }

    resetFailureCount(tabId, failureType) {
        const tabFailures = this.failureCounts.get(tabId);
        if (tabFailures) {
            tabFailures.set(failureType, 0);
        }
    }
}
