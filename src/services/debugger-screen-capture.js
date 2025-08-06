export class DebuggerScreenCapture {
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
                console.warn(
                    "Another debugger is already attached to tab:",
                    tabId
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
                chrome.debugger.onDetach.addListener(
                    this.handleDebuggerDetach.bind(this)
                );
                this.isInitialized = true;
            }

            console.log("Debugger attached to tab:", tabId);
            return { success: true };
        } catch (error) {
            console.error("Failed to attach debugger to tab:", tabId, error);
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
            console.log(
                "Screen recording started via debugger for tab:",
                this.currentTabId
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
            console.log("🔍 Capturing frame for tab:", this.currentTabId);

            // Get current tab info for debugging
            try {
                const tab = await chrome.tabs.get(this.currentTabId);
                console.log("📋 Current tab info:", {
                    id: tab.id,
                    url: tab.url,
                    title: tab.title,
                    active: tab.active,
                    windowId: tab.windowId,
                });
            } catch (error) {
                console.warn("⚠️ Could not get tab info:", error);
            }

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
                console.log(
                    "✅ Frame captured successfully, size:",
                    result.data.length,
                    "bytes for tab:",
                    this.currentTabId
                );
                return result.data;
            } else {
                throw new Error("No screenshot data received");
            }
        } catch (error) {
            console.error(
                "❌ Frame capture failed for tab:",
                this.currentTabId,
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

    handleDebuggerDetach(source, reason) {
        const tabId = source.tabId;
        console.log("Debugger detached from tab:", tabId, "Reason:", reason);

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
            console.log(
                "🔄 Attempting to switch to tab:",
                tabId,
                "Current tab:",
                this.currentTabId
            );
            console.log(
                "📊 Currently attached tabs:",
                Array.from(this.attachedTabs.keys())
            );

            // If we're already on this tab, no need to switch
            if (this.currentTabId === tabId && this.attachedTabs.has(tabId)) {
                console.log("✅ Already on tab:", tabId);
                return { success: true };
            }

            // If we're not attached to the target tab, check if we should attach
            if (!this.attachedTabs.has(tabId)) {
                console.log(
                    "🔗 Tab not attached, checking attachment limit..."
                );

                // Check if we're at the attachment limit
                const maxAttachments = 10;
                if (this.attachedTabs.size >= maxAttachments) {
                    console.warn(
                        `⚠️ At attachment limit (${maxAttachments}), attempting to make room for tab: ${tabId}`
                    );

                    // Try to clean up some old attachments first
                    await this.cleanupUnusedAttachments();

                    // If still at limit, force cleanup by removing least recently used tab
                    if (this.attachedTabs.size >= maxAttachments) {
                        console.log(
                            "🛠️ Forcing cleanup to make room for new tab"
                        );
                        await this.forceCleanupForNewTab(tabId);
                    }
                }

                console.log("🔗 Attaching to tab:", tabId);
                const result = await this.setup(tabId);
                if (!result.success) {
                    throw new Error(result.error);
                }
                console.log("✅ Successfully attached to tab:", tabId);
            }

            // Simply switch the current tab ID - no need to detach from previous tab
            // This allows for instant switching with minimal latency
            const previousTabId = this.currentTabId;
            this.currentTabId = tabId;

            // Track that this tab was accessed
            this.markTabAccessed(tabId);

            console.log(
                "✅ Successfully switched from tab:",
                previousTabId,
                "to tab:",
                tabId
            );
            return { success: true };
        } catch (error) {
            console.error("❌ Failed to switch to tab:", tabId, error);
            return { success: false, error: error.message };
        }
    }

    async forceCleanupForNewTab(newTabId) {
        try {
            console.log("Forcing cleanup to make room for new tab:", newTabId);

            // Get tabs sorted by usage (least recently used first)
            const tabsByUsage = this.getTabsByUsage(true); // ascending order - least recent first

            // Find the least recently used tab that's not the current tab
            const tabToRemove = tabsByUsage
                .filter((tabId) => tabId !== this.currentTabId)
                .shift(); // Get the least recently used tab (first in ascending order)

            if (tabToRemove) {
                console.log(
                    `Removing least recently used tab: ${tabToRemove} to make room for: ${newTabId}`
                );
                await this.detachFromTab(tabToRemove);
            } else {
                console.warn("No suitable tab found to remove for cleanup");
            }
        } catch (error) {
            console.error("Error during forced cleanup:", error);
        }
    }

    async preAttachToVisibleTabs() {
        try {
            console.log(
                "Pre-attaching to visible tabs for low-latency switching..."
            );

            // Get all tabs in ALL windows, not just current window
            const allTabs = await chrome.tabs.query({});

            // Filter out chrome:// and chrome-extension:// tabs
            const eligibleTabs = allTabs.filter(
                (tab) =>
                    !tab.url.startsWith("chrome://") &&
                    !tab.url.startsWith("chrome-extension://")
            );

            console.log(
                `Found ${eligibleTabs.length} eligible tabs out of ${allTabs.length} total tabs across all windows`
            );

            // Limit to maximum 10 tabs to prevent resource issues
            const maxTabs = 10;
            const tabsToAttach = eligibleTabs.slice(0, maxTabs);

            if (eligibleTabs.length > maxTabs) {
                console.warn(
                    `Limiting attachments to ${maxTabs} tabs (${
                        eligibleTabs.length - maxTabs
                    } tabs skipped)`
                );
            }

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

            console.log("Pre-attached to tabs:", results);
            console.log(
                `Total debugger attachments: ${this.attachedTabs.size}`
            );
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
                // Skip chrome:// and chrome-extension:// tabs
                if (
                    tab.url.startsWith("chrome://") ||
                    tab.url.startsWith("chrome-extension://")
                ) {
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
                await chrome.debugger.detach({ tabId });
                this.attachedTabs.delete(tabId);

                // If this was the current tab, clear it
                if (this.currentTabId === tabId) {
                    this.currentTabId = null;
                }

                console.log("Detached from tab:", tabId);
                return { success: true };
            }
            return { success: true }; // Already detached
        } catch (error) {
            console.error("Failed to detach from tab:", tabId, error);
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

            // Detach from all tabs
            const tabIds = Array.from(this.attachedTabs.keys());
            for (const tabId of tabIds) {
                try {
                    await chrome.debugger.detach({ tabId });
                    console.log("Detached from tab:", tabId);
                } catch (error) {
                    console.error("Failed to detach from tab:", tabId, error);
                }
            }

            // Clear all state
            this.attachedTabs.clear();
            this.currentTabId = null;
            this.isInitialized = false;

            console.log("Debugger cleanup completed");
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    async cleanupUnusedAttachments() {
        try {
            console.log("Cleaning up unused debugger attachments...");

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
                    console.log("Cleaned up attachment to closed tab:", tabId);
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
                console.log(
                    `Too many attachments (${this.attachedTabs.size}), cleaning up...`
                );

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

                console.log(`Keeping tabs: ${tabsToKeep.join(", ")}`);
                console.log(`Removing tabs: ${tabsToRemove.join(", ")}`);

                for (const tabId of tabsToRemove) {
                    try {
                        await this.detachFromTab(tabId);
                        console.log("Removed excess attachment to tab:", tabId);
                    } catch (error) {
                        console.error(
                            "Failed to remove excess attachment to tab:",
                            tabId,
                            error
                        );
                    }
                }
            }

            console.log(
                "Cleanup completed. Current attachments:",
                this.attachedTabs.size
            );
        } catch (error) {
            console.error("Error during cleanup:", error);
        }
    }

    async validateAttachedTabs() {
        try {
            console.log("Validating attached tabs...");

            const tabsToDetach = [];

            // Check each attached tab
            for (const [tabId] of this.attachedTabs) {
                try {
                    // Get current tab info
                    const tab = await chrome.tabs.get(tabId);

                    // Check if URL is still valid for debugger attachment
                    if (
                        tab.url.startsWith("chrome://") ||
                        tab.url.startsWith("chrome-extension://")
                    ) {
                        console.log(
                            `Tab ${tabId} now has invalid URL: ${tab.url}, marking for detachment`
                        );
                        tabsToDetach.push(tabId);
                    }
                } catch (error) {
                    // Tab might not exist anymore
                    console.log(
                        `Tab ${tabId} no longer exists, marking for detachment`
                    );
                    tabsToDetach.push(tabId);
                }
            }

            // Detach from invalid tabs
            for (const tabId of tabsToDetach) {
                try {
                    await this.detachFromTab(tabId);
                    console.log(`Detached from invalid tab: ${tabId}`);
                } catch (error) {
                    console.error(
                        `Failed to detach from invalid tab: ${tabId}`,
                        error
                    );
                }
            }

            if (tabsToDetach.length > 0) {
                console.log(
                    `Validated and cleaned up ${tabsToDetach.length} invalid tabs`
                );
            }

            return tabsToDetach.length;
        } catch (error) {
            console.error("Error during tab validation:", error);
            return 0;
        }
    }

    getAttachedTabs() {
        return Array.from(this.attachedTabs.keys());
    }

    getCurrentTabId() {
        return this.currentTabId;
    }

    getDebuggerState() {
        return {
            currentTabId: this.currentTabId,
            attachedTabs: Array.from(this.attachedTabs.keys()),
            isRecording: this.isRecording,
            isInitialized: this.isInitialized,
        };
    }

    getDetailedAttachmentStatus() {
        const tabsByUsage = this.getTabsByUsage(false); // most recent first
        const attachmentDetails = tabsByUsage.map((tabId) => ({
            tabId,
            lastAccessed: this.tabUsageHistory.get(tabId) || 0,
            isCurrent: tabId === this.currentTabId,
            timeSinceAccess:
                Date.now() - (this.tabUsageHistory.get(tabId) || 0),
        }));

        return {
            totalAttachments: this.attachedTabs.size,
            maxAttachments: 10,
            currentTabId: this.currentTabId,
            attachments: attachmentDetails,
            canAttachMore: this.attachedTabs.size < 10,
        };
    }
}
