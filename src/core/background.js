import { MESSAGE_TYPES } from "../utils/constants.js";
import { StorageManager, clearChatStorageOnReload } from "../utils/storage.js";
import { ShoppingAssistant } from "../services/shopping-assistant.js";
import { MicrophoneService } from "../services/microphone-service.js";

class BackgroundService {
    constructor() {
        this.currentTabId = null;
        this.initializeExtension();
        this.setupEventListeners();
    }

    initializeExtension() {
        // Clear chat history on extension reload/install
        this.clearChatHistoryOnReload();

        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            // Clear chat history on fresh install
            clearChatStorageOnReload();
            console.log("🧹 Chat history cleared on extension install");
        });

        chrome.runtime.onStartup.addListener(() => {
            // Clear chat history on browser startup
            clearChatStorageOnReload();
            console.log("🧹 Chat history cleared on browser startup");
        });

        chrome.action.onClicked.addListener(async (tab) => {
            console.log("Background: Extension icon clicked, tab:", tab.url);

            // Store the current tab ID for permission context
            this.currentTabId = tab.id;

            await chrome.sidePanel.open({ tabId: tab.id });
            await StorageManager.set("sidePanelOpen", true);

            console.log("Background: Side panel opened for tab:", tab.id);
        });

        this.restoreStateAfterReload();
    }

    async restoreStateAfterReload() {
        // Hot reload functionality removed
    }

    async clearChatHistoryOnReload() {
        try {
            // Always clear chat history on extension load/reload
            // This ensures a fresh start every time the extension is loaded
            clearChatStorageOnReload();
            console.log("🧹 Chat history cleared on extension load/reload");

            // Set a timestamp to track when the extension was last loaded
            const timestamp = Date.now();
            await StorageManager.set("extensionLastLoaded", timestamp);
            console.log(
                "🔍 Debug - Set extensionLastLoaded timestamp:",
                timestamp
            );

            // Notify any open side panels that the extension has been reloaded
            this.notifySidePanelsOfReload();
        } catch (error) {
            console.error("Error clearing chat history on reload:", error);
        }
    }

    async notifySidePanelsOfReload() {
        try {
            // Use Chrome storage to notify side panels about the reload
            // Side panels can listen for storage changes
            await StorageManager.set("extensionReloaded", Date.now());
            console.log(
                "🔔 Notified side panels of extension reload via storage"
            );
        } catch (error) {
            console.error("Error notifying side panels of reload:", error);
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
            [MESSAGE_TYPES.PAGE_INFO_UPDATE]:
                this.handlePageInfoUpdate.bind(this),
            [MESSAGE_TYPES.GET_CURRENT_TAB_INFO]:
                this.handleGetCurrentTabInfo.bind(this),
            [MESSAGE_TYPES.PROCESS_USER_QUERY]:
                this.handleProcessUserQuery.bind(this),
            [MESSAGE_TYPES.REQUEST_MIC_PERMISSION]:
                this.handleMicPermissionRequest.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_OPENED]:
                this.handleSidePanelOpened.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_CLOSED]:
                this.handleSidePanelClosed.bind(this),
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
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!tab) {
                sendResponse(null);
                return;
            }

            await this.injectContentScript(tab.id, ["content.js"]);

            chrome.tabs.sendMessage(
                tab.id,
                { type: MESSAGE_TYPES.GET_PAGE_INFO },
                (response) => {
                    sendResponse(chrome.runtime.lastError ? null : response);
                }
            );
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
                response:
                    "I'm sorry, I encountered an error while processing your request. Please try again.",
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
