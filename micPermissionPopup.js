// Alternative approach using a popup window for mic permission
class MicPermissionPopupHandler {
    constructor() {
        this.permissionGranted = false;
        this.popup = null;
        this.initializeMessageListener();
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'REQUEST_MIC_PERMISSION_POPUP') {
                this.requestMicPermissionViaPopup().then(sendResponse);
                return true; // Keep message channel open for async response
            }
        });
    }

    async requestMicPermissionViaPopup() {
        try {
            console.log('Opening popup for mic permission...');
            
            // Open a small popup window
            const width = 400;
            const height = 200;
            const left = (screen.width - width) / 2;
            const top = (screen.height - height) / 2;
            
            this.popup = window.open(
                chrome.runtime.getURL('permissionPopup.html'),
                'mic_permission',
                `width=${width},height=${height},left=${left},top=${top}`
            );

            if (!this.popup) {
                return {
                    success: false,
                    error: 'popup_blocked',
                    details: 'Popup was blocked. Please allow popups for this extension.'
                };
            }

            // Wait for result from popup
            return new Promise((resolve) => {
                const messageHandler = (event) => {
                    if (event.origin !== chrome.runtime.getURL('').slice(0, -1)) {
                        return;
                    }

                    if (event.data.type === 'MIC_PERMISSION_POPUP_RESULT') {
                        window.removeEventListener('message', messageHandler);
                        
                        this.permissionGranted = event.data.granted;
                        console.log('Popup permission result:', event.data);
                        
                        resolve({
                            success: event.data.granted,
                            error: event.data.error,
                            details: event.data.details
                        });
                    }
                };
                
                window.addEventListener('message', messageHandler);

                // Timeout after 30 seconds
                setTimeout(() => {
                    window.removeEventListener('message', messageHandler);
                    if (this.popup && !this.popup.closed) {
                        this.popup.close();
                    }
                    resolve({
                        success: false,
                        error: 'timeout',
                        details: 'Permission request timed out'
                    });
                }, 30000);
            });
        } catch (error) {
            console.error('Error in popup permission request:', error);
            return {
                success: false,
                error: 'failed',
                details: error.message
            };
        }
    }
}

// Add to existing micPermissionHandler
if (typeof micPermissionHandler !== 'undefined') {
    micPermissionHandler.popupHandler = new MicPermissionPopupHandler();
}