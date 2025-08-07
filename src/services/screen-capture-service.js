export class ScreenCaptureService {
    constructor() {
        this.attachedTabs = new Map(); // Map of tabId -> attachment status
        this.tabUsageHistory = new Map(); // Map of tabId -> last accessed timestamp
        this.isRecording = false;
        this.currentTabId = null;
        this.frameCallback = null;
        this.errorCallback = null;
        this.isInitialized = false;
        this.isTabSwitchInProgress = false; // Flag to prevent duplicate switches
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
            // Use chrome.debugger.getTargets() to check attachment status
            const targets = await chrome.debugger.getTargets();
            const target = targets.find((t) => t.tabId === tabId);

            // If target exists and has an attached debugger, return true
            return target && target.attached;
        } catch (error) {
            // Fallback to the old method if getTargets() fails
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
            const timestamp = new Date().toISOString();
            console.log(
                `[${timestamp}] 🔧 DEBUGGER SETUP: Starting setup for tab ${tabId}`
            );

            // If already attached to this tab, just return success
            if (this.attachedTabs.has(tabId)) {
                console.log(
                    `[${timestamp}] ✅ DEBUGGER SETUP: Already attached to tab ${tabId}`
                );
                this.currentTabId = tabId;
                return { success: true };
            }

            // Attach debugger to the tab immediately without checking isDebuggerAttached()
            console.log(
                `[${timestamp}] 🔧 DEBUGGER SETUP: Attaching debugger to tab: ${tabId}`
            );
            await chrome.debugger.attach({ tabId }, "1.3");
            console.log(
                `[${timestamp}] ✅ DEBUGGER SETUP: Debugger attached successfully to tab ${tabId}`
            );

            // Enable Page domain for screen capture
            console.log("🔍 Enabling Page domain");
            await chrome.debugger.sendCommand({ tabId }, "Page.enable");
            console.log("✅ Page domain enabled");

            // Enable Runtime domain for error handling
            console.log("🔍 Enabling Runtime domain");
            await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
            console.log("✅ Runtime domain enabled");

            // Mark tab as attached
            console.log(
                `[${timestamp}] 🔧 DEBUGGER SETUP: Setting attachedTabs for tab: ${tabId}`
            );
            this.attachedTabs.set(tabId, true);
            console.log(
                `[${timestamp}] 🔧 DEBUGGER SETUP: Setting currentTabId to: ${tabId}`
            );
            this.currentTabId = tabId;
            console.log(
                `[${timestamp}] 📊 DEBUGGER SETUP: After state setting - attachedTabs:`,
                Array.from(this.attachedTabs.keys())
            );
            console.log(
                `[${timestamp}] 📊 DEBUGGER SETUP: After state setting - currentTabId:`,
                this.currentTabId
            );

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
            console.log("🔍 After setup - currentTabId:", this.currentTabId);
            console.log(
                "🔍 After setup - attachedTabs:",
                Array.from(this.attachedTabs.keys())
            );
            console.log("🔍 After setup - hasStream():", this.hasStream());

            // Ensure hasStream() will return true after setup
            if (!this.hasStream()) {
                console.error(
                    "❌ Setup completed but hasStream() still returns false"
                );
                console.error("❌ currentTabId:", this.currentTabId);
                console.error(
                    "❌ attachedTabs:",
                    Array.from(this.attachedTabs.keys())
                );
                throw new Error(
                    "Setup completed but hasStream() still returns false"
                );
            }

            console.log(
                "✅ Setup completed successfully - hasStream() returns true"
            );
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
            const timestamp = new Date().toISOString();
            console.log(
                `[${timestamp}] 🎬 SCREEN RECORDING: Started via debugger for tab:`,
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
        const timestamp = new Date().toISOString();
        console.log(
            `[${timestamp}] 📸 SCREEN CAPTURE: Attempting to capture from tab ${this.currentTabId}`
        );

        if (!this.currentTabId || !this.attachedTabs.has(this.currentTabId)) {
            console.log(
                `[${timestamp}] ❌ SCREEN CAPTURE: Debugger not attached to current tab ${this.currentTabId}`
            );
            throw new Error("Debugger not attached to current tab");
        }

        // Safety check: verify the current tab still exists before attempting capture
        try {
            await chrome.tabs.get(this.currentTabId);
        } catch (error) {
            // Tab no longer exists, skip capture
            console.log(
                `[${timestamp}] ❌ SCREEN CAPTURE: Current tab ${this.currentTabId} no longer exists, skipping capture`
            );
            throw new Error("Current tab no longer exists");
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
                console.log(
                    `[${timestamp}] ✅ SCREEN CAPTURE: Successfully captured frame from tab ${this.currentTabId}`
                );
                return result.data;
            } else {
                console.log(
                    `[${timestamp}] ❌ SCREEN CAPTURE: No screenshot data received from tab ${this.currentTabId}`
                );
                throw new Error("No screenshot data received");
            }
        } catch (error) {
            // Failsafe mechanism: if debugger capture fails, show warning and skip
            try {
                const tab = await chrome.tabs.get(this.currentTabId);
                const tabName = tab.title || "Unknown";
                const tabUrl = tab.url || "Unknown";
                console.warn(
                    `[${timestamp}] ⚠️ FALLBACK: Screen capture failed - Tab ID: ${this.currentTabId}, Name: "${tabName}", URL: "${tabUrl}", Reason: "Debugger capture command failed - ${error.message}"`
                );
            } catch (tabError) {
                console.warn(
                    `[${timestamp}] ⚠️ FALLBACK: Screen capture failed - Tab ID: ${this.currentTabId}, Name: "Unknown", URL: "Unknown", Reason: "Debugger capture command failed - ${error.message} (Tab info unavailable: ${tabError.message})"`
                );
            }
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
        const timestamp = new Date().toISOString();
        console.log(
            `[${timestamp}] 🔌 DEBUGGER DETACH: Debugger detached from tab:`,
            tabId,
            "URL:",
            tabUrl,
            "Reason:",
            reason
        );

        // Remove from attached tabs
        this.attachedTabs.delete(tabId);
        console.log(
            `[${timestamp}] 📊 DEBUGGER DETACH: Removed tab ${tabId} from attached tabs tracking. Remaining tabs:`,
            Array.from(this.attachedTabs.keys())
        );

        // Clear currentTabId if the detached tab was the current one
        if (this.currentTabId === tabId) {
            console.log(
                `[${timestamp}] 🔌 DEBUGGER DETACH: Clearing currentTabId (was ${tabId})`
            );
            this.currentTabId = null;
        }

        // Only re-attach if the tab was actually closed by the user
        if (reason === "target_closed") {
            console.log(
                `[${timestamp}] Tab ${tabId} was closed, attempting to switch to new active tab...`
            );

            try {
                // Get the current active tab
                const [activeTab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });

                if (activeTab) {
                    console.log(
                        "Found active tab:",
                        activeTab.id,
                        "URL:",
                        activeTab.url
                    );

                    // Check if we're already attached to this tab
                    if (this.attachedTabs.has(activeTab.id)) {
                        // We're already attached, just switch to it
                        this.currentTabId = activeTab.id;
                        console.log(
                            "Successfully switched to already-attached active tab:",
                            activeTab.id
                        );
                    } else {
                        // Try to attach to the active tab
                        const result = await this.setup(activeTab.id);
                        if (result.success) {
                            this.currentTabId = activeTab.id;
                            console.log(
                                "Successfully attached to new active tab:",
                                activeTab.id
                            );
                        } else {
                            try {
                                const tab = await chrome.tabs.get(activeTab.id);
                                const tabName = tab.title || "Unknown";
                                const tabUrl = tab.url || "Unknown";
                                console.warn(
                                    `[${timestamp}] ⚠️ FALLBACK: Debugger attachment failed - Tab ID: ${activeTab.id}, Name: "${tabName}", URL: "${tabUrl}", Reason: "Unable to attach debugger to active tab - ${result.error}. Continuing in listening mode until user switches to attachable tab."`
                                );
                            } catch (tabError) {
                                console.warn(
                                    `[${timestamp}] ⚠️ FALLBACK: Debugger attachment failed - Tab ID: ${activeTab.id}, Name: "Unknown", URL: "Unknown", Reason: "Unable to attach debugger to active tab - ${result.error}. Continuing in listening mode until user switches to attachable tab. (Tab info unavailable: ${tabError.message})"`
                                );
                            }
                            // Don't try to attach to arbitrary tabs - only the active tab matters
                            // But keep listening mode active in case user switches to an attachable tab
                        }
                    }
                } else {
                    console.warn("No active tab found for attachment");
                }
            } catch (error) {
                console.error("Error during automatic tab attachment:", error);
            }
        } else {
            // For all other reasons (programmatic detach, etc.), just log and don't re-attach
            console.log(
                `[${timestamp}] Debugger detached for reason: ${reason} - not re-attaching automatically`
            );
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
            const timestamp = new Date().toISOString();
            console.log(
                `[${timestamp}] 🔄 TAB SWITCH: Attempting to switch to tab ${tabId}`
            );

            // Prevent duplicate switches
            if (this.isTabSwitchInProgress) {
                console.log(
                    `[${timestamp}] ⏭️ TAB SWITCH: Skipping switch - another switch already in progress`
                );
                return { success: false, error: "Tab switch already in progress" };
            }

            // If we're already on this tab, no need to switch
            if (this.currentTabId === tabId && this.attachedTabs.has(tabId)) {
                console.log(
                    `[${timestamp}] ✅ TAB SWITCH: Already on tab ${tabId}, no switch needed`
                );
                return { success: true };
            }

            // Set flag to prevent duplicate switches
            this.isTabSwitchInProgress = true;

            // Check if this is the current active tab
            const [activeTab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            const isCurrentActiveTab = activeTab && activeTab.id === tabId;

            console.log(
                `[${timestamp}] 📊 TAB SWITCH: Current tab: ${this.currentTabId}, Target tab: ${tabId}, Is active: ${isCurrentActiveTab}`
            );

            // For non-active tabs (hot-switching), query all attachable tabs first
            if (!isCurrentActiveTab) {
                // Get all tabs in the current window
                const allTabs = await chrome.tabs.query({
                    currentWindow: true,
                });

                // Filter out restricted URLs and tabs with existing debuggers
                const attachableTabs = [];
                for (const tab of allTabs) {
                    // Skip restricted URLs
                    if (this.isRestrictedUrl(tab.url)) {
                        continue;
                    }

                    // Check if debugger is already attached
                    const isAttached = await this.isDebuggerAttached(tab.id);
                    if (isAttached) {
                        continue;
                    }

                    attachableTabs.push(tab);
                }

                // Check if the target tab is in the attachable list
                const targetTabAttachable = attachableTabs.find(
                    (tab) => tab.id === tabId
                );
                if (!targetTabAttachable) {
                    // Silently skip if target tab is not attachable
                    return {
                        success: false,
                        error: "Target tab is not attachable",
                    };
                }

                // Try to attach to top 10 attachable tabs (including the target)
                const maxAttachments = 10;
                const tabsToAttach = attachableTabs.slice(0, maxAttachments);

                for (const tab of tabsToAttach) {
                    if (!this.attachedTabs.has(tab.id)) {
                        try {
                            const result = await this.setup(tab.id);
                            if (!result.success) {
                                // Silently skip failed attachments for hot-switching
                                continue;
                            }
                        } catch (error) {
                            // Silently skip failed attachments for hot-switching
                            continue;
                        }
                    }
                }

                // Check if we successfully attached to the target tab
                if (!this.attachedTabs.has(tabId)) {
                    return {
                        success: false,
                        error: "Failed to attach to target tab",
                    };
                }
            } else {
                // For current active tab, try to attach directly
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
                        // Failsafe mechanism: if attachment fails, show warning and return failure
                        try {
                            const tab = await chrome.tabs.get(tabId);
                            const tabName = tab.title || "Unknown";
                            const tabUrl = tab.url || "Unknown";
                            console.warn(
                                `[${timestamp}] ⚠️ FALLBACK: Tab switch attachment failed - Tab ID: ${tabId}, Name: "${tabName}", URL: "${tabUrl}", Reason: "Debugger setup failed during tab switch - ${result.error}. Skipping attachment to prevent system instability."`
                            );
                        } catch (tabError) {
                            console.warn(
                                `[${timestamp}] ⚠️ FALLBACK: Tab switch attachment failed - Tab ID: ${tabId}, Name: "Unknown", URL: "Unknown", Reason: "Debugger setup failed during tab switch - ${result.error}. Skipping attachment to prevent system instability. (Tab info unavailable: ${tabError.message})"`
                            );
                        }
                        return { success: false, error: result.error };
                    }
                }
            }

            // Switch the current tab ID - no need to detach from previous tab
            this.currentTabId = tabId;
            this.markTabAccessed(tabId);

            console.log(
                `[${timestamp}] ✅ TAB SWITCH: Successfully switched to tab ${tabId}`
            );
            console.log(
                `[${timestamp}] 📊 TAB SWITCH: Attached tabs count: ${this.attachedTabs.size}`
            );

            return { success: true };
        } catch (error) {
            console.error("Failed to switch to tab:", tabId, error);
            return { success: false, error: error.message };
        } finally {
            // Always reset the flag, regardless of success or failure
            this.isTabSwitchInProgress = false;
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
            // Store the original current tab ID to preserve it
            const originalCurrentTabId = this.currentTabId;

            // Get all tabs in the current window
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            // Filter out restricted URLs and tabs with existing debuggers
            const attachableTabs = [];
            for (const tab of allTabs) {
                // Skip restricted URLs
                if (this.isRestrictedUrl(tab.url)) {
                    continue;
                }

                // Skip the current active tab (it's already handled in setup())
                if (tab.active) {
                    continue;
                }

                // Use isDebuggerAttached() to check for conflicts (hot-switching candidates only)
                const isAttached = await this.isDebuggerAttached(tab.id);
                if (isAttached) {
                    console.log(
                        `Skipping tab ${tab.id} - debugger already attached (hot-switching candidate)`
                    );
                    continue;
                }

                attachableTabs.push(tab);
            }

            // Limit to maximum 10 tabs to prevent resource issues
            const maxTabs = 10;
            const tabsToAttach = attachableTabs.slice(0, maxTabs);

            // Sort tabs by last accessed time (most recent first) for hot-switching priority
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

            // Restore the original current tab ID
            this.currentTabId = originalCurrentTabId;

            console.log(
                `Pre-attached to ${results.length} hot-switching candidate tabs`
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
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] 🎬 SCREEN RECORDING: Stopped`);
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

                    // Don't try to find a new tab here - let the debugger detach handler do it
                    // This prevents the "No new tabs available" error when tabs are closing
                    console.log(
                        "Tab closed, waiting for debugger detach handler to re-attach"
                    );

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

            // Don't re-attach to new tabs during cleanup - user wants to stop listening completely
            if (removedTabsCount > 0) {
                console.log(
                    `Removed ${removedTabsCount} closed tabs during cleanup - not re-attaching to new tabs`
                );
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
            // Get all tabs in the current window
            const allTabs = await chrome.tabs.query({ currentWindow: true });

            // Filter out restricted URLs and tabs with existing debuggers
            const attachableTabs = [];
            for (const tab of allTabs) {
                // Skip restricted URLs
                if (this.isRestrictedUrl(tab.url)) {
                    continue;
                }

                // Check if debugger is already attached
                const isAttached = await this.isDebuggerAttached(tab.id);
                if (isAttached) {
                    continue;
                }

                // Skip tabs that are already being tracked
                if (this.attachedTabs.has(tab.id)) {
                    continue;
                }

                attachableTabs.push(tab);
            }

            // Find the best tab to attach to (prioritize active tab, then recent tabs)
            let bestTab = null;

            console.log("Attachable tabs found:", attachableTabs.length);
            attachableTabs.forEach((tab) => {
                console.log(
                    "  - Tab",
                    tab.id,
                    "URL:",
                    tab.url,
                    "Active:",
                    tab.active
                );
            });

            // First, try to find the active tab
            const activeTab = attachableTabs.find((tab) => tab.active);
            if (activeTab) {
                bestTab = activeTab;
                console.log("Selected active tab:", activeTab.id);
            } else if (attachableTabs.length > 0) {
                // If no active tab, pick the most recently accessed tab
                bestTab = attachableTabs.sort(
                    (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
                )[0];
                console.log("Selected most recent tab:", bestTab.id);
            }

            if (bestTab) {
                console.log(
                    "Found new tab to attach to:",
                    bestTab.id,
                    "URL:",
                    bestTab.url
                );
                const result = await this.setup(bestTab.id);
                if (result.success) {
                    console.log(
                        "Successfully attached to new tab:",
                        bestTab.id,
                        "URL:",
                        bestTab.url
                    );
                    return { success: true, tabId: bestTab.id };
                } else {
                    console.log(
                        "Failed to attach to new tab:",
                        bestTab.id,
                        "Error:",
                        result.error
                    );
                    return { success: false, error: result.error };
                }
            } else {
                // No new tabs available - this means we can't attach to the active tab
                console.log(
                    "No new tabs available to attach to - cannot attach to active tab"
                );
                return { success: false, error: "Cannot attach to active tab" };
            }
        } catch (error) {
            console.error("Error finding and attaching to new tab:", error);
            return { success: false, error: error.message };
        }
    }
}
