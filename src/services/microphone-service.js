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
        }

        return this.requestPermissionFromTab(tab.id);
    }

    static async injectPermissionScript(tabId) {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/mic-permission.js']
        });
    }

    static waitForInitialization() {
        return new Promise(resolve => setTimeout(resolve, 200));
    }

    static requestPermissionFromTab(tabId) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.REQUEST_MIC_PERMISSION }, (response) => {
                if (chrome.runtime.lastError) {
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

