import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { MessageRenderer } from "../ui/message-renderer.js";

export class LifecycleManager {
    constructor(uiManager, eventManager, conversationHandler, messageRenderer) {
        this.uiManager = uiManager;
        this.eventManager = eventManager;
        this.conversationHandler = conversationHandler;
        this.messageRenderer = messageRenderer;
    }

    trackSidePanelLifecycle() {
        // Clean up any orphaned debugger attachments when sidepanel opens
        this.cleanupDebuggerAttachments();

        chrome.runtime
            .sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED })
            .catch(() => {});
        chrome.storage.local.set({ sidePanelOpen: true }).catch(() => {});

        let sidepanelCloseTimeout = null;
        const CLOSE_DELAY = 10000; // 10 seconds delay - increased to prevent premature closure

        const setSidePanelClosed = async () => {
            // Stop listening mode if active
            if (this.conversationHandler.isConversationActive()) {
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
        };

        const handleSidePanelHidden = () => {
            // Clear any existing timeout
            if (sidepanelCloseTimeout) {
                clearTimeout(sidepanelCloseTimeout);
            }

            // Don't set close timeout if listening mode is active
            if (this.conversationHandler.isConversationActive()) {
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
            if (this.conversationHandler.isConversationActive()) {
                try {
                    // Give the debugger a moment to re-attach if needed
                    await this.conversationHandler.checkAndSwitchToActiveTab();
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

    updatePageInfo(pageInfo) {
        return this.eventManager.updatePageInfo(pageInfo);
    }

    async saveState() {
        return this.uiManager.saveState();
    }

    async checkAndClearChatHistoryOnReload() {
        try {
            const extensionReloaded = await this.getExtensionReloadedMarker();
            const lastChatSaved = this.getLastChatSavedTime();

            if (
                extensionReloaded &&
                lastChatSaved &&
                extensionReloaded > lastChatSaved
            ) {
                await UnifiedConversationManager.clearConversation();
                await this.clearExtensionReloadedMarker();
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
                messages.forEach((msg) => {
                    const messageDiv = this.messageRenderer.createMessage(
                        msg.content,
                        msg.type
                    );
                    this.uiManager.elements.messages.appendChild(messageDiv);
                });

                this.hideWelcomeScreen();
                this.scrollToBottom();
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
            if (
                this.conversationHandler &&
                this.conversationHandler.screenCapture
            ) {
                await this.conversationHandler.screenCapture.cleanup();
            }
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
