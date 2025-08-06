export class DebuggerScreenCapture {
    constructor() {
        this.isAttached = false;
        this.isRecording = false;
        this.currentTabId = null;
        this.frameCallback = null;
        this.errorCallback = null;
    }

    async setup(tabId) {
        try {
            this.currentTabId = tabId;
            
            // Attach debugger to the tab
            await chrome.debugger.attach({ tabId }, '1.3');
            this.isAttached = true;
            
            // Enable Page domain for screen capture
            await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
            
            // Enable Runtime domain for error handling
            await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
            
            console.log('Debugger attached to tab:', tabId);
            return { success: true };
        } catch (error) {
            console.error('Failed to attach debugger:', error);
            return { success: false, error: error.message };
        }
    }

    async startRecording(frameCallback, errorCallback) {
        if (!this.isAttached || !this.currentTabId) {
            throw new Error('Debugger not attached');
        }

        try {
            this.frameCallback = frameCallback;
            this.errorCallback = errorCallback;
            
            // Start screen capture using Page.captureScreenshot
            await chrome.debugger.sendCommand(
                { tabId: this.currentTabId },
                'Page.captureScreenshot',
                {
                    format: 'jpeg',
                    quality: 80,
                    clip: null,
                    fromSurface: true
                }
            );
            
            this.isRecording = true;
            console.log('Screen recording started via debugger');
            
            // Set up event listener for debugger events
            chrome.debugger.onEvent.addListener(this.handleDebuggerEvent.bind(this));
            
            return { success: true };
        } catch (error) {
            console.error('Failed to start recording:', error);
            return { success: false, error: error.message };
        }
    }

    async captureFrame() {
        if (!this.isAttached || !this.currentTabId) {
            throw new Error('Debugger not attached');
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
            console.error('Frame capture failed:', error);
            throw error;
        }
    }

    handleDebuggerEvent(source, method, params) {
        if (source.tabId !== this.currentTabId) {
            return;
        }

        if (method === 'Page.screenshotCaptured') {
            if (this.frameCallback && params.data) {
                this.frameCallback(params.data);
            }
        } else if (method === 'Runtime.exceptionThrown') {
            if (this.errorCallback) {
                this.errorCallback(params.exceptionDetails);
            }
        }
    }

    async stopRecording() {
        if (!this.isAttached) {
            return;
        }

        try {
            this.isRecording = false;
            
            // Remove event listener
            chrome.debugger.onEvent.removeListener(this.handleDebuggerEvent.bind(this));
            
            // Detach debugger
            await chrome.debugger.detach({ tabId: this.currentTabId });
            this.isAttached = false;
            this.currentTabId = null;
            
            console.log('Screen recording stopped and debugger detached');
            return { success: true };
        } catch (error) {
            console.error('Failed to stop recording:', error);
            return { success: false, error: error.message };
        }
    }

    isActive() {
        return this.isAttached && this.isRecording;
    }

    hasStream() {
        return this.isAttached;
    }

    async cleanup() {
        if (this.isAttached) {
            await this.stopRecording();
        }
    }
} 