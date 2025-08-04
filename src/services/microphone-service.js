import { MESSAGE_TYPES } from '../utils/constants.js';

export class MicrophoneService {
    static async request() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            return { success: false, error: 'no_active_tab' };
        }

        try {
            await this.injectPermissionScript(tab.id);
            await this.waitForInitialization();
        } catch (error) {
            console.log('Permission script injection:', error.message);
        }

        return this.requestPermissionFromTab(tab.id);
    }

    static async injectPermissionScript(tabId) {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['mic-permission.js']
        });
    }

    static waitForInitialization() {
        return new Promise(resolve => setTimeout(resolve, 200));
    }

    static requestPermissionFromTab(tabId) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.REQUEST_MIC_PERMISSION }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Content script error:', chrome.runtime.lastError);
                    resolve({
                        success: false,
                        error: 'content_script_failed',
                        details: 'Cannot inject permission iframe on this page'
                    });
                } else {
                    resolve(response || { success: false, error: 'no_response' });
                }
            });
        });
    }
}

export class MicPermissionHandler {
    constructor() {
        this.permissionGranted = false;
        this.iframe = null;
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
            console.log('Content script: Starting mic permission request...');
            
            if (this.permissionGranted) {
                console.log('Permission already granted');
                return { success: true, alreadyGranted: true };
            }

            this.createPermissionIframe();
            return this.waitForPermissionResult();
        } catch (error) {
            console.error('Error requesting mic permission:', error);
            return {
                success: false,
                error: 'failed',
                details: error.message
            };
        }
    }

    createPermissionIframe() {
        this.iframe = document.createElement('iframe');
        this.iframe.src = chrome.runtime.getURL('mic-permission-page.html');
        this.iframe.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 1px;
            height: 1px;
        `;
        document.body.appendChild(this.iframe);
        console.log('Created iframe with src:', this.iframe.src);
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
        
        if (this.iframe && this.iframe.parentNode) {
            document.body.removeChild(this.iframe);
            this.iframe = null;
        }
    }
}