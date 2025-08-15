import { MESSAGE_TYPES } from "../utils/constants.js";
import { SESSION_MODE } from "../utils/constants.js";
import { broadcastSessionMode } from "../utils/storage/broadcast.js";
import { UnifiedConversationManager } from "../utils/storage.js";
// MessageRenderer removed; using ConversationRenderer via UIManager

export class LifecycleManager {
    constructor(uiManager, eventManager, multimediaOrchestrator, _unused) {
        this.uiManager = uiManager;
        this.eventManager = eventManager;
        this.multimediaOrchestrator = multimediaOrchestrator;
        this.messageRenderer = null;
        // Access the server client via orchestrator
        this.serverClient = this.multimediaOrchestrator?.serverClient || null;
    }

    trackSidePanelLifecycle() {
        // Clean up any orphaned debugger attachments when sidepanel opens
        this.cleanupDebuggerAttachments();

        chrome.runtime
            .sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED })
            .catch(() => {});
        chrome.storage.local.set({ sidePanelOpen: true }).catch(() => {});

        // Establish WebSocket connection immediately on side panel open
        try {
            this.serverClient?.connect?.();
        } catch (_) {}

        // Broadcast IDLE when side panel opens
        try {
            broadcastSessionMode(SESSION_MODE.IDLE);
        } catch (_) {}

        let sidepanelCloseTimeout = null;
        const CLOSE_DELAY = 10000; // 10 seconds delay - increased to prevent premature closure

        const setSidePanelClosed = async () => {
            // Stop listening mode if active
            if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
                await this.eventManager.stopVoiceInput();
                // Notify background script that listening has stopped
                chrome.runtime
                    .sendMessage({ type: MESSAGE_TYPES.LISTENING_STOPPED })
                    .catch(() => {});
            }

            // Clean up debugger attachments when sidepanel closes
            await this.cleanupDebuggerAttachments();

            chrome.runtime
                .sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_CLOSED })
                .catch(() => {});
            chrome.storage.local.set({ sidePanelOpen: false }).catch(() => {});

            // Close the WebSocket connection when side panel closes
            try {
                await this.serverClient?.disconnect?.();
            } catch (_) {}

            // Broadcast IDLE on side panel close
            try {
                broadcastSessionMode(SESSION_MODE.IDLE);
            } catch (_) {}
        };

        const handleSidePanelHidden = () => {
            // Clear any existing timeout
            if (sidepanelCloseTimeout) {
                clearTimeout(sidepanelCloseTimeout);
            }

            // Don't set close timeout if listening mode is active
            if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
                return;
            }

            // Set a delayed timeout for closure
            sidepanelCloseTimeout = setTimeout(async () => {
                // Only close if the document is still hidden after the delay
                if (document.hidden) {
                    await setSidePanelClosed();
                }
            }, CLOSE_DELAY);
        };

        const handleSidePanelVisible = async () => {
            // Cancel the delayed closure if sidepanel becomes visible again
            if (sidepanelCloseTimeout) {
                clearTimeout(sidepanelCloseTimeout);
                sidepanelCloseTimeout = null;
            }

            // Check if debugger is properly attached before resuming
            if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
                try {
                    // Give the debugger a moment to re-attach if needed
                    // This will be handled by VideoHandler in the new architecture
                } catch (error) {
                    // Ignore debugger re-attachment errors
                }
            }

            // Re-open sidepanel
            chrome.runtime
                .sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED })
                .catch(() => {});
            chrome.storage.local.set({ sidePanelOpen: true }).catch(() => {});
        };

        // Handle beforeunload (actual page unload) - immediate closure
        window.addEventListener("beforeunload", setSidePanelClosed);

        // Handle visibility changes with delay
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                handleSidePanelHidden();
            } else {
                handleSidePanelVisible();
            }
        });
    }

    // Page info update path removed

    async saveState() {
        return this.uiManager.saveState();
    }

    async checkAndClearChatHistoryOnReload() {
        try {
            const extensionReloaded = await this.getExtensionReloadedMarker();
            if (extensionReloaded) {
                // Extension actually reloaded: start a new chat
                await UnifiedConversationManager.clearConversation();
                await this.clearExtensionReloadedMarker();
                console.debug(
                    "[Lifecycle] Extension reloaded -> cleared conversation"
                );
            }
        } catch (error) {
            // Ignore errors
        }
    }

    async getExtensionReloadedMarker() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(["extensionReloaded"], resolve);
            });
            return result.extensionReloaded;
        } catch (error) {
            return null;
        }
    }

    async clearExtensionReloadedMarker() {
        try {
            await new Promise((resolve) => {
                chrome.storage.local.remove(["extensionReloaded"], resolve);
            });
        } catch (error) {
            // Ignore errors
        }
    }

    async getLastChatSavedTime() {
        try {
            const conversation =
                await UnifiedConversationManager.getConversation();
            return conversation.lastUpdated;
        } catch (error) {
            return null;
        }
    }

    async handleExtensionReloaded() {
        try {
            await UnifiedConversationManager.clearConversation();
            this.uiManager.elements.messages.innerHTML = "";
            this.showWelcomeScreen();
        } catch (error) {
            // Ignore errors
        }
    }

    async restoreState() {
        try {
            // Migrate from old localStorage if needed
            await UnifiedConversationManager.migrateFromLocalStorage();

            // Get messages and welcome screen state from unified manager
            const messages =
                await UnifiedConversationManager.getMessagesForUI();
            const isWelcomeVisible =
                await UnifiedConversationManager.getWelcomeScreenState();

            if (messages && messages.length > 0) {
                this.uiManager.conversationRenderer?.restore(messages);
                this.hideWelcomeScreen();
            } else if (!isWelcomeVisible) {
                this.hideWelcomeScreen();
            } else {
                this.uiManager.uiState.showStatus("Start a chat", "info");
            }
        } catch (error) {
            console.error("Error restoring state:", error);
            this.uiManager.uiState.showStatus("Start a chat", "info");
        }
    }

    async cleanupDebuggerAttachments() {
        try {
            // Clean up any existing debugger attachments
            // This will be handled by VideoHandler in the new architecture
            // For now, we'll skip this during the transition
        } catch (error) {
            console.error("Error cleaning up debugger attachments:", error);
        }
    }

    // UI delegation methods
    hideWelcomeScreen() {
        return this.uiManager.hideWelcomeScreen();
    }

    showWelcomeScreen() {
        return this.uiManager.showWelcomeScreen();
    }

    scrollToBottom() {
        return this.uiManager.scrollToBottom();
    }
}
