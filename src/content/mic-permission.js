import { MESSAGE_TYPES } from '../utils/constants.js';

class MicPermissionHandler {
    constructor() {
        this.permissionGranted = false;
        this.initializeMessageListener();
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === MESSAGE_TYPES.REQUEST_MIC_PERMISSION) {
                this.requestMicPermission().then(sendResponse);
                return true;
            }
            
            if (request.type === 'CHECK_MIC_PERMISSION') {
                sendResponse({ granted: this.permissionGranted });
                return false;
            }
        });
    }

    async requestMicPermission() {
        try {
            if (this.permissionGranted) {
                return { success: true, alreadyGranted: true };
            }

            return this.waitForPermissionResult();
        } catch (error) {
            return {
                success: false,
                error: 'failed',
                details: error.message
            };
        }
    }

    waitForPermissionResult() {
        return new Promise((resolve) => {
            const messageHandler = (event) => {
                if (event.origin !== chrome.runtime.getURL('').slice(0, -1)) {
                    return;
                }

                if (event.data.type === MESSAGE_TYPES.MIC_PERMISSION_RESULT) {
                    this.cleanupPermissionRequest(messageHandler);
                    this.permissionGranted = event.data.granted;
                    
                    resolve({
                        success: event.data.granted,
                        error: event.data.error,
                        details: event.data.details
                    });
                }
            };
            
            window.addEventListener('message', messageHandler);

            setTimeout(() => {
                this.cleanupPermissionRequest(messageHandler);
                resolve({
                    success: false,
                    error: 'timeout',
                    details: 'Permission request timed out'
                });
            }, 10000);
        });
    }

    cleanupPermissionRequest(messageHandler) {
        window.removeEventListener('message', messageHandler);
    }
}

// Initialize the permission handler when the content script loads
new MicPermissionHandler();