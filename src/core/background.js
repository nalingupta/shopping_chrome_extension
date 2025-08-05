import { MESSAGE_TYPES } from '../utils/constants.js';
import { StorageManager } from '../utils/storage.js';
import { ShoppingAssistant } from '../services/shopping-assistant.js';
import { MicrophoneService } from '../services/microphone-service.js';

class BackgroundService {
    constructor() {
        this.tabCaptureStream = null;
        this.tabCaptureActive = false;
        this.currentTabId = null;
        this.initializeExtension();
        this.setupEventListeners();
        this.setupHotReload();
    }

    initializeExtension() {
        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        });

        chrome.action.onClicked.addListener(async (tab) => {
            console.log('Background: Extension icon clicked, tab:', tab.url);
            
            // Store the current tab ID for permission context
            this.currentTabId = tab.id;
            
            await chrome.sidePanel.open({ tabId: tab.id });
            await StorageManager.set('sidePanelOpen', true);
            
            console.log('Background: Side panel opened for tab:', tab.id);
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
                        await this.clearChatState();
                    }
                    
                    await StorageManager.remove('hotReloadState');
                }
            } catch (error) {
                // Ignore errors
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
            [MESSAGE_TYPES.SIDE_PANEL_CLOSED]: this.handleSidePanelClosed.bind(this),
            [MESSAGE_TYPES.CAPTURE_TAB]: this.handleCaptureTab.bind(this),
            [MESSAGE_TYPES.START_TAB_CAPTURE]: this.handleStartTabCapture.bind(this),
            [MESSAGE_TYPES.STOP_TAB_CAPTURE]: this.handleStopTabCapture.bind(this)
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
            // Ignore injection errors
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
            await this.clearChatState();
            
            await StorageManager.set('hotReloadState', {
                shouldRestore: true,
                timestamp: Date.now()
            });
            
            chrome.runtime.reload();
        } catch (error) {
            // Ignore errors
        }
    }

    async clearChatState() {
        try {
            await StorageManager.set('clearChatOnNextLoad', true);
            
            const storage = await chrome.storage.local.get();
            const keysToRemove = Object.keys(storage).filter(key => 
                key.includes('chatState') || 
                key.includes('messages') ||
                key.includes('conversation')
            );
            
            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
            }
        } catch (error) {
            // Ignore errors during cleanup
        }
    }

    async handleCaptureTab(request, sender, sendResponse) {
        try {
            console.log('Background: handleCaptureTab called');
            console.log('Background: Current tab ID from click:', this.currentTabId);
            
            // Get current active tab
            const tabs = await new Promise((resolve) => {
                chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                    console.log('Background: Active tabs query result:', tabs?.length);
                    if (chrome.runtime.lastError) {
                        console.log('Background: tabs.query error:', chrome.runtime.lastError);
                    }
                    resolve(tabs || []);
                });
            });
            
            if (tabs.length === 0) {
                throw new Error('No active tab found');
            }
            
            const activeTab = tabs[0];
            console.log('Background: Active tab ID:', activeTab.id, 'URL:', activeTab.url);
            
            // Check if it's a capturable page
            if (activeTab.url.startsWith('chrome://') || 
                activeTab.url.startsWith('chrome-extension://') ||
                activeTab.url.startsWith('edge://') ||
                activeTab.url.startsWith('about:')) {
                throw new Error(`Cannot capture browser internal page: ${activeTab.url}`);
            }
            
            // Try to capture with explicit window ID
            const dataUrl = await new Promise((resolve, reject) => {
                console.log('Background: Attempting captureVisibleTab for window:', activeTab.windowId);
                chrome.tabs.captureVisibleTab(
                    activeTab.windowId,
                    {format: 'png', quality: 80},
                    (dataUrl) => {
                        console.log('Background: captureVisibleTab completed');
                        console.log('Background: Has dataUrl:', !!dataUrl);
                        console.log('Background: Runtime error:', chrome.runtime.lastError?.message);
                        
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (dataUrl) {
                            console.log('Background: DataUrl length:', dataUrl.length);
                            resolve(dataUrl);
                        } else {
                            reject(new Error('No data returned from captureVisibleTab'));
                        }
                    }
                );
            });
            
            sendResponse({ success: true, dataUrl });
        } catch (error) {
            console.error('Background: handleCaptureTab failed:', error.message);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleStartTabCapture(request, sender, sendResponse) {
        try {
            // Try to start tab capture stream
            const stream = await new Promise((resolve, reject) => {
                chrome.tabCapture.capture(
                    {
                        video: true,
                        audio: false,
                        videoConstraints: {
                            mandatory: {
                                maxWidth: 1920,
                                maxHeight: 1080,
                                maxFrameRate: 15
                            }
                        }
                    },
                    (stream) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else if (stream) {
                            resolve(stream);
                        } else {
                            reject(new Error('No stream returned'));
                        }
                    }
                );
            });
            
            this.tabCaptureStream = stream;
            this.tabCaptureActive = true;
            
            sendResponse({ success: true, hasStream: true });
        } catch (error) {
            // Fallback to static capture
            sendResponse({ success: true, hasStream: false, fallback: true });
        }
    }

    async handleStopTabCapture(request, sender, sendResponse) {
        try {
            if (this.tabCaptureStream) {
                this.tabCaptureStream.getTracks().forEach(track => track.stop());
                this.tabCaptureStream = null;
            }
            this.tabCaptureActive = false;
            
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
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
            // Ignore errors
        }
    }
}

// Initialize the background service
new BackgroundService();