export class URLMonitor {
    constructor() {
        // State management for restricted URL handling
        this.monitoredTabs = new Map(); // Map of tabId -> monitoring info
        this.failureCounts = new Map(); // Map of tabId -> failure count by type
        this.urlMonitoringIntervals = new Map(); // Map of tabId -> interval ID
        this.maxMonitoredTabs = 5;
    }

    setTabManager(tabManager) {
        this.tabManager = tabManager;
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

                const result = await this.tabManager.setup(tabId);
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

    getMonitoredTabs() {
        return this.monitoredTabs;
    }

    getMaxMonitoredTabs() {
        return this.maxMonitoredTabs;
    }
}
