export class ScreenCapture {
    constructor() {
        this.hasPermission = false;
        this.isActiveFlag = false;
    }

    async setup() {
        if (this.hasPermission) {
            return true;
        }

        try {
            // Test static capture capability
            await this.testStaticCapture();
            this.hasPermission = true;
            this.isActiveFlag = true;
            console.log('Screen capture: Static capture ready');
            return true;
        } catch (error) {
            console.error('Static capture setup failed:', error);
            throw error;
        }
    }

    async testStaticCapture() {
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

    async captureScreenshot() {
        if (!this.hasPermission) {
            throw new Error('Screen capture not initialized');
        }

        // Capture a single screenshot via background script
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: 'CAPTURE_TAB' },
                (response) => {
                    if (response && response.success && response.dataUrl) {
                        // Extract base64 data from data URL
                        const base64Data = response.dataUrl.split(',')[1];
                        resolve(base64Data);
                    } else {
                        reject(new Error(response?.error || 'Screenshot capture failed'));
                    }
                }
            );
        });
    }

    hasStream() {
        return this.hasPermission;
    }

    isActive() {
        return this.isActiveFlag;
    }

    stop() {
        this.hasPermission = false;
        this.isActiveFlag = false;
        // Notify background script to stop any tab capture resources
        chrome.runtime.sendMessage({ type: 'STOP_TAB_CAPTURE' });
    }
}