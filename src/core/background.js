import { MESSAGE_TYPES } from "../utils/constants.js";
import { StorageManager, clearChatStorageOnReload } from "../utils/storage.js";
// Legacy GeminiTextClient removed; text is routed via server WS through the server client in the side panel
import { MicrophoneService } from "../services/microphone-service.js";

class BackgroundService {
    constructor() {
        this.currentTabId = null;
        this.initializeExtension();
        this.setupEventListeners();
    }

    initializeExtension() {
        // Mark extension reload; LifecycleManager will clear conversation when side panel loads
        this.markExtensionReloaded();

        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            this.markExtensionReloaded();
        });

        chrome.runtime.onStartup.addListener(() => {
            this.markExtensionReloaded();
        });

        chrome.action.onClicked.addListener(async (tab) => {
            // Store the current tab ID for permission context
            this.currentTabId = tab.id;

            await chrome.sidePanel.open({ tabId: tab.id });
            await StorageManager.set("sidePanelOpen", true);
        });

        this.restoreStateAfterReload();
    }

    async restoreStateAfterReload() {
        // Hot reload functionality removed
    }

    async markExtensionReloaded() {
        try {
            await StorageManager.set("extensionReloaded", Date.now());
        } catch (error) {
            // Ignore errors
        }
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                const handler = this.getMessageHandler(request.type);
                if (handler) {
                    handler(request, sender, sendResponse);
                    return true;
                }
            }
        );
    }

    getMessageHandler(type) {
        const handlers = {
            [MESSAGE_TYPES.PROCESS_USER_QUERY]:
                this.handleProcessUserQuery.bind(this),
            [MESSAGE_TYPES.REQUEST_MIC_PERMISSION]:
                this.handleMicPermissionRequest.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_OPENED]:
                this.handleSidePanelOpened.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_CLOSED]:
                this.handleSidePanelClosed.bind(this),
            [MESSAGE_TYPES.LISTENING_STOPPED]:
                this.handleListeningStopped.bind(this),
            [MESSAGE_TYPES.CONVERSATION_UPDATED]:
                this.handleConversationUpdated.bind(this),
        };

        return handlers[type] || null;
    }

    // Page info update handlers removed

    async handleProcessUserQuery(request, sender, sendResponse) {
        // Route text to side panel UI; server client will forward to server over WS
        try {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.PROCESS_USER_QUERY,
                data: request.data,
            });
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleMicPermissionRequest(request, sender, sendResponse) {
        try {
            const result = await MicrophoneService.request();
            sendResponse(result);
        } catch (error) {
            sendResponse({
                success: false,
                error: "permission_request_failed",
                details: error.message,
            });
        }
    }

    async handleSidePanelOpened(request, sender, sendResponse) {
        try {
            await StorageManager.set("sidePanelOpen", true);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleSidePanelClosed(request, sender, sendResponse) {
        try {
            await StorageManager.set("sidePanelOpen", false);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleListeningStopped(request, sender, sendResponse) {
        try {
            // Any additional cleanup can be added here if needed
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleConversationUpdated(request, sender, sendResponse) {
        try {
            // Broadcast conversation update to all extension contexts
            chrome.runtime
                .sendMessage({
                    type: MESSAGE_TYPES.CONVERSATION_UPDATED,
                })
                .catch(() => {
                    // Ignore errors - not all contexts may be listening
                });

            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async injectContentScript(tabId, files) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files,
            });
        } catch (error) {
            // Ignore injection errors
        }
    }
}

// Initialize the background service
new BackgroundService();
