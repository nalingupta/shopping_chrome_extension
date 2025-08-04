import { MESSAGE_TYPES } from '../utils/constants.js';
import { StorageManager } from '../utils/storage.js';
import { ShoppingAssistant } from '../services/shopping-assistant.js';
import { MicrophoneService } from '../services/microphone-service.js';

class BackgroundService {
    constructor() {
        this.initializeExtension();
        this.setupEventListeners();
        this.setupHotReload();
    }

    initializeExtension() {
        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        });

        chrome.action.onClicked.addListener(async (tab) => {
            await chrome.sidePanel.open({ tabId: tab.id });
            await StorageManager.set('sidePanelOpen', true);
        });

        this.restoreStateAfterReload();
    }

    async restoreStateAfterReload() {
        setTimeout(async () => {
            try {
                const hotReloadState = await StorageManager.get('hotReloadState');
                const sidePanelOpen = await StorageManager.get('sidePanelOpen');
                
                if (hotReloadState?.shouldRestore && sidePanelOpen) {
                    const timeSinceReload = Date.now() - hotReloadState.timestamp;
                    
                    if (timeSinceReload < 10000) {
                        await this.showReloadNotification();
                    }
                    
                    await StorageManager.remove('hotReloadState');
                }
            } catch (error) {
            }
        }, 500);
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            const handler = this.getMessageHandler(request.type);
            if (handler) {
                handler(request, sender, sendResponse);
                return true;
            }
        });
    }

    getMessageHandler(type) {
        const handlers = {
            [MESSAGE_TYPES.PAGE_INFO_UPDATE]: this.handlePageInfoUpdate.bind(this),
            [MESSAGE_TYPES.GET_CURRENT_TAB_INFO]: this.handleGetCurrentTabInfo.bind(this),
            [MESSAGE_TYPES.PROCESS_USER_QUERY]: this.handleProcessUserQuery.bind(this),
            [MESSAGE_TYPES.REQUEST_MIC_PERMISSION]: this.handleMicPermissionRequest.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_OPENED]: this.handleSidePanelOpened.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_CLOSED]: this.handleSidePanelClosed.bind(this)
        };
        
        return handlers[type] || null;
    }

    handlePageInfoUpdate(request, sender) {
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.PAGE_INFO_BROADCAST,
            data: request.data,
            tabId: sender.tab?.id,
        });
    }

    async handleGetCurrentTabInfo(request, sender, sendResponse) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                sendResponse(null);
                return;
            }

            await this.injectContentScript(tab.id, ['content.js']);
            
            chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.GET_PAGE_INFO }, (response) => {
                sendResponse(chrome.runtime.lastError ? null : response);
            });
        } catch (error) {
            sendResponse(null);
        }
    }

    async handleProcessUserQuery(request, sender, sendResponse) {
        try {
            const response = await ShoppingAssistant.processQuery(request.data);
            sendResponse(response);
        } catch (error) {
            sendResponse({ 
                success: false,
                error: error.message,
                response: "I'm sorry, I encountered an error while processing your request. Please try again."
            });
        }
    }

    async handleMicPermissionRequest(request, sender, sendResponse) {
        try {
            const result = await MicrophoneService.request();
            sendResponse(result);
        } catch (error) {
            sendResponse({
                success: false,
                error: 'permission_request_failed',
                details: error.message
            });
        }
    }


    async handleSidePanelOpened(request, sender, sendResponse) {
        try {
            await StorageManager.set('sidePanelOpen', true);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleSidePanelClosed(request, sender, sendResponse) {
        try {
            await StorageManager.set('sidePanelOpen', false);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async injectContentScript(tabId, files) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files
            });
        } catch (error) {
        }
    }

    setupHotReload() {
        const startTime = Date.now();
        
        setInterval(async () => {
            try {
                const response = await fetch(chrome.runtime.getURL('.reload-signal'));
                const data = await response.json();
                
                if (data.timestamp > startTime) {
                    await this.handleHotReload();
                }
            } catch (error) {
                // Ignore - reload signal file might not exist
            }
        }, 1000);
    }

    async handleHotReload() {
        try {
            await StorageManager.set('hotReloadState', {
                shouldRestore: true,
                timestamp: Date.now()
            });
            
            chrome.runtime.reload();
        } catch (error) {
        }
    }

    async showReloadNotification() {
        try {
            await chrome.action.setBadgeText({ text: "↻" });
            await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
            
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "" }).catch(() => {});
            }, 3000);
        } catch (error) {
        }
    }

}

// Initialize the background service
new BackgroundService();