// Content script to handle initial microphone permission request
// This runs in the context of web pages to inject a permission request iframe

class MicPermissionHandler {
    constructor() {
        this.permissionGranted = false;
        this.iframe = null;
        this.initializeMessageListener();
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'REQUEST_MIC_PERMISSION') {
                this.requestMicPermission().then(sendResponse);
                return true; // Keep message channel open for async response
            }
            
            if (request.type === 'CHECK_MIC_PERMISSION') {
                sendResponse({ granted: this.permissionGranted });
                return false;
            }
        });
    }

    async requestMicPermission() {
        try {
            console.log('Content script: Starting mic permission request...');
            
            // Check if permission was already granted
            if (this.permissionGranted) {
                console.log('Permission already granted');
                return { success: true, alreadyGranted: true };
            }

            // Create an invisible iframe that loads our extension page
            this.iframe = document.createElement('iframe');
            this.iframe.src = chrome.runtime.getURL('mic-permission-page.html');
            this.iframe.style.display = 'none';
            this.iframe.style.position = 'fixed';
            this.iframe.style.top = '0';
            this.iframe.style.left = '0';
            this.iframe.style.width = '1px';
            this.iframe.style.height = '1px';
            document.body.appendChild(this.iframe);
            
            console.log('Created iframe with src:', this.iframe.src);

            // Wait for the iframe to load and request permission
            return new Promise((resolve) => {
                let messageHandler;
                
                // Listen for messages from the iframe
                messageHandler = (event) => {
                    console.log('Received postMessage:', event.data, 'from:', event.origin);
                    
                    if (event.origin !== chrome.runtime.getURL('').slice(0, -1)) {
                        return;
                    }

                    if (event.data.type === 'MIC_PERMISSION_RESULT') {
                        // Clean up
                        window.removeEventListener('message', messageHandler);
                        
                        if (this.iframe && this.iframe.parentNode) {
                            document.body.removeChild(this.iframe);
                            this.iframe = null;
                        }

                        this.permissionGranted = event.data.granted;
                        console.log('Permission result:', event.data);
                        
                        resolve({
                            success: event.data.granted,
                            error: event.data.error,
                            details: event.data.details
                        });
                    }
                };
                
                window.addEventListener('message', messageHandler);

                // Set a timeout in case something goes wrong
                setTimeout(() => {
                    window.removeEventListener('message', messageHandler);
                    
                    if (this.iframe && this.iframe.parentNode) {
                        document.body.removeChild(this.iframe);
                        this.iframe = null;
                    }
                    
                    console.log('Permission request timed out');
                    resolve({
                        success: false,
                        error: 'timeout',
                        details: 'Permission request timed out'
                    });
                }, 10000); // 10 second timeout
            });
        } catch (error) {
            console.error('Error requesting mic permission:', error);
            return {
                success: false,
                error: 'failed',
                details: error.message
            };
        }
    }
}

// Initialize the permission handler when the content script loads
const micPermissionHandler = new MicPermissionHandler();