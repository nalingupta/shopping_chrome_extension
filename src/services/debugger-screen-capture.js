export class DebuggerScreenCapture {
    constructor() {
        this.attachedTabs = new Map(); // Map of tabId -> attachment status
        this.isRecording = false;
        this.currentTabId = null;
        this.frameCallback = null;
        this.errorCallback = null;
        this.isInitialized = false;
    }

    async setup(tabId) {
        try {
            // If already attached to this tab, just return success
            if (this.attachedTabs.has(tabId)) {
                this.currentTabId = tabId;
                return { success: true };
            }
            
            // Attach debugger to the tab
            await chrome.debugger.attach({ tabId }, '1.3');
            
            // Enable Page domain for screen capture
            await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
            
            // Enable Runtime domain for error handling
            await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
            
            // Mark tab as attached
            this.attachedTabs.set(tabId, true);
            this.currentTabId = tabId;
            
            // Set up event listener if not already done
            if (!this.isInitialized) {
                chrome.debugger.onEvent.addListener(this.handleDebuggerEvent.bind(this));
                chrome.debugger.onDetach.addListener(this.handleDebuggerDetach.bind(this));
                this.isInitialized = true;
            }
            
            console.log('Debugger attached to tab:', tabId);
            return { success: true };
        } catch (error) {
            console.error('Failed to attach debugger to tab:', tabId, error);
            return { success: false, error: error.message || 'Unknown debugger error' };
        }
    }

    async startRecording(frameCallback, errorCallback) {
        if (!this.currentTabId || !this.attachedTabs.has(this.currentTabId)) {
            throw new Error('Debugger not attached to current tab');
        }

        try {
            this.frameCallback = frameCallback;
            this.errorCallback = errorCallback;
            
            this.isRecording = true;
            console.log('Screen recording started via debugger for tab:', this.currentTabId);
            
            return { success: true };
        } catch (error) {
            console.error('Failed to start recording:', error);
            return { success: false, error: error.message || 'Unknown recording error' };
        }
    }

    async captureFrame() {
        if (!this.currentTabId || !this.attachedTabs.has(this.currentTabId)) {
            throw new Error('Debugger not attached to current tab');
        }

        try {
            const result = await chrome.debugger.sendCommand(
                { tabId: this.currentTabId },
                'Page.captureScreenshot',
                {
                    format: 'jpeg',
                    quality: 80,
                    clip: null,
                    fromSurface: true
                }
            );
            
            if (result && result.data) {
                return result.data;
            } else {
                throw new Error('No screenshot data received');
            }
        } catch (error) {
            console.error('Frame capture failed for tab:', this.currentTabId, error);
            throw new Error(error.message || 'Frame capture failed');
        }
    }

    handleDebuggerEvent(source, method, params) {
        if (source.tabId !== this.currentTabId) {
            return;
        }

        if (method === 'Runtime.exceptionThrown') {
            if (this.errorCallback) {
                this.errorCallback(params.exceptionDetails);
            }
        }
    }

    handleDebuggerDetach(source, reason) {
        const tabId = source.tabId;
        console.log('Debugger detached from tab:', tabId, 'Reason:', reason);
        
        // Remove from attached tabs
        this.attachedTabs.delete(tabId);
        
        // If this was the current tab, clear it
        if (this.currentTabId === tabId) {
            this.currentTabId = null;
        }
        
        // Notify about the detach if we have an error callback
        if (this.errorCallback) {
            this.errorCallback({
                type: 'debugger_detached',
                tabId: tabId,
                reason: reason
            });
        }
    }

    async switchToTab(tabId) {
        try {
            // If not attached to this tab, attach first
            if (!this.attachedTabs.has(tabId)) {
                const result = await this.setup(tabId);
                if (!result.success) {
                    throw new Error(result.error);
                }
            }
            
            this.currentTabId = tabId;
            console.log('Switched to tab:', tabId);
            return { success: true };
        } catch (error) {
            console.error('Failed to switch to tab:', tabId, error);
            return { success: false, error: error.message };
        }
    }

    async attachToAllTabs() {
        try {
            const tabs = await chrome.tabs.query({});
            const results = [];
            
            for (const tab of tabs) {
                // Skip chrome:// and chrome-extension:// tabs
                if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    continue;
                }
                
                try {
                    const result = await this.setup(tab.id);
                    results.push({ tabId: tab.id, success: result.success, error: result.error });
                } catch (error) {
                    results.push({ tabId: tab.id, success: false, error: error.message });
                }
            }
            
            console.log('Attached to tabs:', results);
            return results;
        } catch (error) {
            console.error('Failed to attach to all tabs:', error);
            return [];
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            return { success: true };
        }

        try {
            this.isRecording = false;
            console.log('Screen recording stopped');
            return { success: true };
        } catch (error) {
            console.error('Failed to stop recording:', error);
            return { success: false, error: error.message };
        }
    }

    isActive() {
        return this.isRecording && this.currentTabId && this.attachedTabs.has(this.currentTabId);
    }

    hasStream() {
        return this.currentTabId && this.attachedTabs.has(this.currentTabId);
    }

    async cleanup() {
        try {
            // Stop recording
            await this.stopRecording();
            
            // Detach from all tabs
            for (const [tabId] of this.attachedTabs) {
                try {
                    await chrome.debugger.detach({ tabId });
                    console.log('Detached from tab:', tabId);
                } catch (error) {
                    console.error('Failed to detach from tab:', tabId, error);
                }
            }
            
            // Clear all state
            this.attachedTabs.clear();
            this.currentTabId = null;
            this.isInitialized = false;
            
            console.log('Debugger cleanup completed');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    getAttachedTabs() {
        return Array.from(this.attachedTabs.keys());
    }

    getCurrentTabId() {
        return this.currentTabId;
    }
} 