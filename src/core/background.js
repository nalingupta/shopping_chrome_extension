import { MESSAGE_TYPES } from "../utils/constants.js";
import { StorageManager } from "../utils/storage.js";
import { MicrophoneService } from "../services/microphone-service.js";
import { DEBUG_BACKGROUND_LOGS, DEBUG_HOVER_LOGS } from "../config/debug.js";

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
            [MESSAGE_TYPES.MOUSE_BUCKET]:
                this.handleMouseBucket.bind(this),
            [MESSAGE_TYPES.MOUSE_BUCKET_LINKS]:
                this.handleMouseBucketLinks.bind(this),
            [MESSAGE_TYPES.SESSION_STARTED]:
                this.handleSessionStarted.bind(this),
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

    async handleMouseBucket(request, sender, sendResponse) {
        try {
            const payload = request?.data || {};
            if (DEBUG_HOVER_LOGS) console.debug("[HoverBucket]", payload);

            // Transform: extract unique hrefs from payload.summary.links
            try {
                const links = Array.isArray(payload?.summary?.links)
                    ? payload.summary.links
                          .map((l) => (l && typeof l.href === "string" ? l.href.trim() : null))
                          .filter((href) => !!href && !/^javascript:/i.test(href))
                    : [];
                if (links.length > 0) {
                    // Determine capture timestamp for the bucket (last item tsAbsMs preferred)
                    let captureTsAbsMs = null;
                    try {
                        const items = Array.isArray(payload?.items) ? payload.items : [];
                        if (items.length && typeof items[items.length - 1]?.tsAbsMs === "number") {
                            captureTsAbsMs = items[items.length - 1].tsAbsMs;
                        } else if (
                            typeof payload?.startedAtMs === "number" &&
                            payload?.rangeRelMs && typeof payload.rangeRelMs.end === "number"
                        ) {
                            captureTsAbsMs = payload.startedAtMs + payload.rangeRelMs.end;
                        }
                    } catch (_) {}

                    // Re-broadcast additive event for consumers interested only in links
                    chrome.runtime
                        .sendMessage({
                            type: MESSAGE_TYPES.MOUSE_BUCKET_LINKS,
                            links,
                            captureTsAbsMs: captureTsAbsMs || Date.now(),
                            ts: Date.now(),
                        })
                        .catch(() => {});
                    if (DEBUG_HOVER_LOGS) console.log("[HoverLinks]", links);
                }
            } catch (_) {}
        } catch (_) {}
        // No response needed; fire-and-forget
    }

    async handleMouseBucketLinks(request, sender, sendResponse) {
        try {
            const links = Array.isArray(request?.links) ? request.links : [];
            if (DEBUG_HOVER_LOGS) console.log("[HoverLinks:received]", links);
        } catch (_) {}
        // No response needed; fire-and-forget
    }

    async handleSessionStarted(request, sender, sendResponse) {
        try {
            const wall = Number(request?.sessionStartWallMs) || null;
            if (wall) {
                if (DEBUG_BACKGROUND_LOGS) console.log("[SessionStarted] wall=", wall);
                chrome.storage.local
                    .set({ sessionClock: { sessionStartWallMs: wall, updatedAt: Date.now() } })
                    .catch(() => {});
            }
        } catch (_) {}
        // No response needed; fire-and-forget
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
