export class ScreenCapture {
    constructor() {
        this.screenStream = null;
        this.hasPermission = false;
        this.onScreenSharingEnded = null;
        this.fallbackMode = false; // Track if we're using static screenshots
        this.screenshotInterval = null;
    }

    async setup() {
        if (this.hasPermission && (this.isStreamActive() || this.fallbackMode)) {
            return true;
        }

        try {
            // Try live streaming first
            this.screenStream = await this.getTabStream();
            if (this.screenStream) {
                this.hasPermission = true;
                this.fallbackMode = false;
                this.setupStreamEndListener();
                console.log('Tab capture: Live streaming enabled');
                return true;
            }
        } catch (error) {
            console.log('Live tab capture failed:', error.message);
            
            // Fallback to static screenshots
            try {
                await this.setupStaticCapture();
                this.hasPermission = true;
                this.fallbackMode = true;
                console.log('Tab capture: Using static screenshot fallback');
                return true;
            } catch (fallbackError) {
                console.error('Both live and static capture failed:', fallbackError);
                throw fallbackError;
            }
        }
        
        return false;
    }

    async getTabStream() {
        try {
            // Request tab capture from background script (which has activeTab permission)
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: 'START_TAB_CAPTURE' },
                    resolve
                );
            });
            
            if (!response.success) {
                throw new Error('Tab capture request failed');
            }
            
            if (response.hasStream) {
                // Background script has live stream - we can't transfer it directly
                // For now, fall back to static capture
                throw new Error('Live stream transfer not implemented - using static fallback');
            }
            
            if (response.fallback) {
                throw new Error('Background fallback to static capture');
            }
            
            throw new Error('Unexpected tab capture response');
            
        } catch (error) {
            console.error('Failed to get tab stream:', error);
            throw error;
        }
    }

    async setupStaticCapture() {
        // Test static capture via background script
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'CAPTURE_TAB' },
                (response) => {
                    if (response && response.success) {
                        resolve(true);
                    } else {
                        reject(new Error(response?.error || 'Static capture test failed'));
                    }
                }
            );
        });
    }

    createStaticStream() {
        // Create a fake stream that provides static screenshots
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        // Create a MediaStream from canvas
        const stream = canvas.captureStream(1); // 1 FPS
        
        // Update canvas with screenshots periodically
        this.screenshotInterval = setInterval(() => {
            this.updateCanvasWithScreenshot(canvas, ctx);
        }, 2000); // Every 2 seconds
        
        return stream;
    }

    updateCanvasWithScreenshot(canvas, ctx) {
        chrome.runtime.sendMessage(
            { type: 'CAPTURE_TAB' },
            (response) => {
                if (response && response.success && response.dataUrl) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                    img.src = response.dataUrl;
                }
            }
        );
    }

    setupStreamEndListener() {
        if (!this.screenStream) return;
        
        this.screenStream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => {
                this.handleScreenSharingEnded();
            });
        });
    }

    handleScreenSharingEnded() {
        this.screenStream = null;
        this.hasPermission = false;
        
        if (this.onScreenSharingEnded) {
            this.onScreenSharingEnded();
        }
    }

    isStreamActive() {
        if (!this.screenStream) return false;
        const videoTracks = this.screenStream.getVideoTracks();
        return videoTracks.length > 0 && videoTracks[0].readyState === 'live';
    }

    hasStream() {
        return (this.screenStream !== null && this.isStreamActive()) || this.fallbackMode;
    }

    getStream() {
        if (this.fallbackMode && !this.screenStream) {
            // Create static stream on demand
            this.screenStream = this.createStaticStream();
        }
        return this.screenStream;
    }

    isActive() {
        return this.hasPermission && (this.isStreamActive() || this.fallbackMode);
    }

    stop() {
        // Clear screenshot interval if using fallback
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        // Notify background script to stop tab capture
        chrome.runtime.sendMessage({ type: 'STOP_TAB_CAPTURE' });
        
        this.hasPermission = false;
        this.fallbackMode = false;
    }
}