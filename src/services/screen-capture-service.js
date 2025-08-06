export class ScreenCaptureService {
    constructor() {
        this.attachedTabs = new Map(); // Map of tabId -> attachment status
        this.tabUsageHistory = new Map(); // Map of tabId -> last accessed timestamp
        this.isRecording = false;
        this.currentTabId = null;
        this.frameCallback = null;
        this.errorCallback = null;
        this.isInitialized = false;
    }

    // Track when a tab is accessed for better cleanup prioritization
    markTabAccessed(tabId) {
        this.tabUsageHistory.set(tabId, Date.now());
    }

    // Get tabs sorted by usage (most recently used first by default)
    getTabsByUsage(ascending = false) {
        return Array.from(this.attachedTabs.keys()).sort((a, b) => {
            const timeA = this.tabUsageHistory.get(a) || 0;
            const timeB = this.tabUsageHistory.get(b) || 0;
            return ascending ? timeA - timeB : timeB - timeA; // ascending for cleanup, descending for keeping
        });
    }

    async isDebuggerAttached(tabId) {
        try {
            // Try to attach a temporary debugger - if it fails, another debugger is attached
            await chrome.debugger.attach({ tabId }, "1.3");
            // If we get here, no debugger was attached, so detach immediately
            await chrome.debugger.detach({ tabId });
            return false;
        } catch (error) {
            // If attach fails, another debugger is likely attached
            return true;
        }
    }

    async setup(tabId) {
        try {
            // If already attached to this tab, just return success
            if (this.attachedTabs.has(tabId)) {
                this.currentTabId = tabId;
                return { success: true };
            }

            // Check if another debugger is already attached
            const isAttached = await this.isDebuggerAttached(tabId);
            if (isAttached) {
                const tabUrl = await this.getTabUrl(tabId);
                console.warn(
                    "Another debugger is already attached to tab:",
                    tabId,
                    "URL:",
                    tabUrl
                );
                return {
                    success: false,
                    error: "Another debugger is already attached to this tab",
                };
            }

            // Attach debugger to the tab
            await chrome.debugger.attach({ tabId }, "1.3");

            // Enable Page domain for screen capture
            await chrome.debugger.sendCommand({ tabId }, "Page.enable");

            // Enable Runtime domain for error handling
            await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");

            // Mark tab as attached
            this.attachedTabs.set(tabId, true);
            this.currentTabId = tabId;

            // Set up event listener if not already done
            if (!this.isInitialized) {
                chrome.debugger.onEvent.addListener(
                    this.handleDebuggerEvent.bind(this)
                );
                chrome.debugger.onDetach.addListener((source, reason) =>
                    this.handleDebuggerDetach(source, reason)
                );
                this.isInitialized = true;
            }

            const tabUrl = await this.getTabUrl(tabId);
            console.log("Debugger attached to tab:", tabId, "URL:", tabUrl);
            return { success: true };
        } catch (error) {
            const tabUrl = await this.getTabUrl(tabId);
            console.error(
                "Failed to attach debugger to tab:",
                tabId,
                "URL:",
                tabUrl,
                error
            );
            return {
                success: false,
                error: error.message || "Unknown debugger error",
            };
        }
    }

    async startRecording(frameCallback, errorCallback) {
        if (!this.currentTabId || !this.attachedTabs.has(this.currentTabId)) {
            throw new Error("Debugger not attached to current tab");
        }

        try {
            this.frameCallback = frameCallback;
            this.errorCallback = errorCallback;

            this.isRecording = true;
            const tabUrl = await this.getTabUrl(this.currentTabId);
            console.log(
                "Screen recording started via debugger for tab:",
                this.currentTabId,
                "URL:",
                tabUrl
            );

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
        if (!this.currentTabId || !this.attachedTabs.has(this.currentTabId)) {
            throw new Error("Debugger not attached to current tab");
        }

        try {
            const result = await chrome.debugger.sendCommand(
                { tabId: this.currentTabId },
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
            const tabUrl = await this.getTabUrl(this.currentTabId);
            console.error(
                "Frame capture failed for tab:",
                this.currentTabId,
                "URL:",
                tabUrl,
                error
            );
            throw new Error(error.message || "Frame capture failed");
        }
    }

    handleDebuggerEvent(source, method, params) {
        if (source.tabId !== this.currentTabId) {
            return;
        }

        if (method === "Runtime.exceptionThrown") {
            if (this.errorCallback) {
                this.errorCallback(params.exceptionDetails);
            }
        }
    }

    async handleDebuggerDetach(source, reason) {
        const tabId = source.tabId;
        const tabUrl = await this.getTabUrl(tabId);
        console.log(
            "Debugger detached from tab:",
            tabId,
            "URL:",
            tabUrl,
            "Reason:",
            reason
        );

        // Remove from attached tabs
        this.attachedTabs.delete(tabId);

        // If this was the current tab, clear it
        if (this.currentTabId === tabId) {
            this.currentTabId = null;
        }

        // Notify about the detach if we have an error callback
        if (this.errorCallback) {
            this.errorCallback({
                type: "debugger_detached",
                tabId: tabId,
                reason: reason,
            });
        }
    }

    async switchToTab(tabId) {
        try {
            // If we're already on this tab, no need to switch
            if (this.currentTabId === tabId && this.attachedTabs.has(tabId)) {
                return { success: true };
            }

            // Check if the target tab URL is restricted before attempting to attach
            try {
                const tab = await chrome.tabs.get(tabId);
                if (this.isRestrictedUrl(tab.url)) {
                    console.log("Cannot switch to restricted URL:", tab.url);
                    return {
                        success: false,
                        error: "Cannot attach to restricted URL",
                    };
                }
            } catch (error) {
                console.log(
                    "Tab no longer exists or cannot be accessed:",
                    tabId
                );
                return { success: false, error: "Tab no longer exists" };
            }

            // If we're not attached to the target tab, check if we should attach
            if (!this.attachedTabs.has(tabId)) {
                // Check if we're at the attachment limit
                const maxAttachments = 10;
                if (this.attachedTabs.size >= maxAttachments) {
                    // Try to clean up some old attachments first
                    await this.cleanupUnusedAttachments();

                    // If still at limit, force cleanup by removing least recently used tab
                    if (this.attachedTabs.size >= maxAttachments) {
                        await this.forceCleanupForNewTab(tabId);
                    }
                }

                const result = await this.setup(tabId);
                if (!result.success) {
                    throw new Error(result.error);
                }
            }

            // Switch the current tab ID - no need to detach from previous tab
            this.currentTabId = tabId;
            this.markTabAccessed(tabId);

            return { success: true };
        } catch (error) {
            console.error("Failed to switch to tab:", tabId, error);
            return { success: false, error: error.message };
        }
    }

    async forceCleanupForNewTab(newTabId) {
        try {
            // Get tabs sorted by usage (least recently used first)
            const tabsByUsage = this.getTabsByUsage(true); // ascending order - least recent first

            // Find the least recently used tab that's not the current tab
            const tabToRemove = tabsByUsage
                .filter((tabId) => tabId !== this.currentTabId)
                .shift(); // Get the least recently used tab (first in ascending order)

            if (tabToRemove) {
                await this.detachFromTab(tabToRemove);
            }
        } catch (error) {
            console.error("Error during forced cleanup:", error);
        }
    }

    async preAttachToVisibleTabs() {
        try {
            // Get all tabs in ALL windows, not just current window
            const allTabs = await chrome.tabs.query({});

            // Filter out restricted URLs
            const eligibleTabs = allTabs.filter(
                (tab) => !this.isRestrictedUrl(tab.url)
            );

            // Limit to maximum 10 tabs to prevent resource issues
            const maxTabs = 10;
            const tabsToAttach = eligibleTabs.slice(0, maxTabs);

            // Prioritize active tab first, then recent tabs
            const activeTab = tabsToAttach.find((tab) => tab.active);
            const otherTabs = tabsToAttach.filter((tab) => !tab.active);

            // Sort other tabs by last accessed time (most recent first)
            otherTabs.sort(
                (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
            );

            const prioritizedTabs = activeTab
                ? [activeTab, ...otherTabs]
                : otherTabs;

            const results = [];
            for (const tab of prioritizedTabs) {
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

            return results;
        } catch (error) {
            console.error("Failed to pre-attach to visible tabs:", error);
            return [];
        }
    }

    async attachToAllTabs() {
        try {
            const tabs = await chrome.tabs.query({});
            const results = [];

            for (const tab of tabs) {
                // Skip restricted URLs
                if (this.isRestrictedUrl(tab.url)) {
                    continue;
                }

                try {
                    const result = await this.setup(tab.id);
                    results.push({
                        tabId: tab.id,
                        success: result.success,
                        error: result.error,
                    });
                } catch (error) {
                    results.push({
                        tabId: tab.id,
                        success: false,
                        error: error.message,
                    });
                }
            }

            console.log("Attached to tabs:", results);
            return results;
        } catch (error) {
            console.error("Failed to attach to all tabs:", error);
            return [];
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            return { success: true };
        }

        try {
            this.isRecording = false;
            console.log("Screen recording stopped");
            return { success: true };
        } catch (error) {
            console.error("Failed to stop recording:", error);
            return { success: false, error: error.message };
        }
    }

    isActive() {
        return (
            this.isRecording &&
            this.currentTabId &&
            this.attachedTabs.has(this.currentTabId)
        );
    }

    hasStream() {
        return this.currentTabId && this.attachedTabs.has(this.currentTabId);
    }

    async detachFromTab(tabId) {
        try {
            if (this.attachedTabs.has(tabId)) {
                // Check if the tab still exists before attempting to detach
                try {
                    await chrome.tabs.get(tabId);
                } catch (error) {
                    // Tab no longer exists, just remove from tracking
                    console.log(
                        "Tab no longer exists, removing from tracking:",
                        tabId
                    );
                    this.attachedTabs.delete(tabId);
                    if (this.currentTabId === tabId) {
                        this.currentTabId = null;
                    }

                    // Try to find and attach to a new tab to maintain hot-switching capability
                    await this.findAndAttachToNewTab();

                    return { success: true };
                }

                await chrome.debugger.detach({ tabId });
                this.attachedTabs.delete(tabId);

                // If this was the current tab, clear it
                if (this.currentTabId === tabId) {
                    this.currentTabId = null;
                }

                const tabUrl = await this.getTabUrl(tabId);
                console.log("Detached from tab:", tabId, "URL:", tabUrl);
                return { success: true };
            }
            return { success: true }; // Already detached
        } catch (error) {
            const tabUrl = await this.getTabUrl(tabId);
            console.error(
                "Failed to detach from tab:",
                tabId,
                "URL:",
                tabUrl,
                error
            );
            // Remove from our tracking even if detach failed
            this.attachedTabs.delete(tabId);
            if (this.currentTabId === tabId) {
                this.currentTabId = null;
            }
            return { success: false, error: error.message };
        }
    }

    async cleanup() {
        try {
            // Stop recording
            await this.stopRecording();

            // Check if there are any attached tabs before attempting to detach
            if (this.attachedTabs.size === 0) {
                console.log("No tabs attached, skipping detachment");
                return;
            }

            // Get all currently open tabs to filter out closed ones
            const allTabs = await chrome.tabs.query({});
            const openTabIds = new Set(allTabs.map((tab) => tab.id));

            // Track how many tabs we're removing to maintain hot-switching capability
            let removedTabsCount = 0;

            // Detach from all tabs that still exist
            const tabIds = Array.from(this.attachedTabs.keys());
            for (const tabId of tabIds) {
                // Skip tabs that no longer exist
                if (!openTabIds.has(tabId)) {
                    console.log("Skipping detach for closed tab:", tabId);
                    removedTabsCount++;
                    continue;
                }

                try {
                    await chrome.debugger.detach({ tabId });
                    const tabUrl = await this.getTabUrl(tabId);
                    console.log("Detached from tab:", tabId, "URL:", tabUrl);
                } catch (error) {
                    const tabUrl = await this.getTabUrl(tabId);
                    console.error(
                        "Failed to detach from tab:",
                        tabId,
                        "URL:",
                        tabUrl,
                        error
                    );
                }
            }

            // Try to replace removed tabs with new ones to maintain hot-switching capability
            if (removedTabsCount > 0) {
                console.log(
                    `Attempting to replace ${removedTabsCount} removed tabs with new ones`
                );
                for (let i = 0; i < removedTabsCount; i++) {
                    await this.findAndAttachToNewTab();
                }
            }

            // Clean up debugger event listeners
            this.cleanupDebuggerListeners();

            // Clear all state
            this.attachedTabs.clear();
            this.currentTabId = null;
            this.isInitialized = false;

            console.log("Debugger cleanup completed");
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
            // First, validate all attached tabs (check URLs and existence)
            await this.validateAttachedTabs();

            // Get all currently open tabs
            const allTabs = await chrome.tabs.query({});
            const openTabIds = new Set(allTabs.map((tab) => tab.id));

            // Find attachments to tabs that no longer exist
            const tabsToDetach = [];
            for (const [tabId] of this.attachedTabs) {
                if (!openTabIds.has(tabId)) {
                    tabsToDetach.push(tabId);
                }
            }

            // Detach from closed tabs
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

            // Limit the number of attached tabs to prevent resource issues
            const maxAttachments = 10;
            if (this.attachedTabs.size > maxAttachments) {
                // Get all attached tab IDs
                const attachedTabIds = Array.from(this.attachedTabs.keys());

                // Keep current tab and most recently accessed tabs
                const tabsToKeep = [this.currentTabId];

                // Add most recently accessed tabs (up to maxAttachments - 1)
                const recentTabs = this.getTabsByUsage(false) // descending order - most recent first
                    .filter((tabId) => tabId !== this.currentTabId)
                    .slice(0, maxAttachments - 1);

                tabsToKeep.push(...recentTabs);

                // Remove excess attachments
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

            // Check each attached tab
            for (const [tabId] of this.attachedTabs) {
                try {
                    // Get current tab info
                    const tab = await chrome.tabs.get(tabId);

                    // Check if URL is still valid for debugger attachment
                    if (this.isRestrictedUrl(tab.url)) {
                        tabsToDetach.push(tabId);
                    }
                } catch (error) {
                    // Tab might not exist anymore
                    tabsToDetach.push(tabId);
                }
            }

            // Detach from invalid tabs
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

    async findAndAttachToNewTab() {
        try {
            // Get all currently open tabs
            const allTabs = await chrome.tabs.query({});

            // Filter out restricted URLs
            const eligibleTabs = allTabs.filter(
                (tab) => !this.isRestrictedUrl(tab.url)
            );

            // Find a tab that's not currently being tracked
            const untrackedTab = eligibleTabs.find(
                (tab) => !this.attachedTabs.has(tab.id)
            );

            if (untrackedTab) {
                console.log(
                    "Found new tab to attach to:",
                    untrackedTab.id,
                    "URL:",
                    untrackedTab.url
                );
                const result = await this.setup(untrackedTab.id);
                if (result.success) {
                    console.log(
                        "Successfully attached to new tab:",
                        untrackedTab.id,
                        "URL:",
                        untrackedTab.url
                    );
                    return { success: true, tabId: untrackedTab.id };
                } else {
                    console.log(
                        "Failed to attach to new tab:",
                        untrackedTab.id,
                        "Error:",
                        result.error
                    );
                    return { success: false, error: result.error };
                }
            } else {
                console.log("No new tabs available to attach to");
                return { success: false, error: "No new tabs available" };
            }
        } catch (error) {
            console.error("Error finding and attaching to new tab:", error);
            return { success: false, error: error.message };
        }
    }
}
