import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { MessageRenderer } from "../ui/message-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { AudioHandler } from "../services/audio-handler.js";
import { UIManager } from "./ui-manager.js";
import { EventManager } from "./event-manager.js";

export class ShoppingAssistant {
    constructor() {
        this.uiManager = new UIManager();
        this.audioHandler = new AudioHandler();
        this.eventManager = new EventManager(this.uiManager, this.audioHandler);

        this.uiManager.initializeElements();
        this.eventManager.initializeEventListeners();
        this.initializeCallbacks();
        this.trackSidePanelLifecycle();
        this.checkAndClearChatHistoryOnReload();
        this.eventManager.initializeCrossWindowSync();
        this.restoreState();
        this.getCurrentPageInfo();
    }

    initializeCallbacks() {
        this.audioHandler.setTranscriptionCallback((transcription) => {
            this.eventManager.handleTranscriptionReceived(transcription);
        });

        this.audioHandler.setInterimCallback((interimText) => {
            this.eventManager.handleInterimTranscription(interimText);
        });

        this.audioHandler.setBotResponseCallback((response) => {
            this.eventManager.handleBotResponse(response);
        });

        this.audioHandler.setStatusCallback((status, type, duration) => {
            this.uiManager.uiState.showStatus(status, type, duration);
        });

        this.audioHandler.setListeningStoppedCallback((reason) => {
            this.eventManager.handleListeningStopped(reason);
        });
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
            if (this.audioHandler.isListening()) {
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
            if (this.audioHandler.isListening()) {
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
            if (this.audioHandler.isListening()) {
                try {
                    // Give the debugger a moment to re-attach if needed
                    await this.audioHandler.checkAndSwitchToActiveTab();
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

    async getCurrentPageInfo() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: MESSAGE_TYPES.GET_CURRENT_TAB_INFO },
                    resolve
                );
            });

            if (response) {
                this.eventManager.updatePageInfo(response);
            }
        } catch (error) {
            // Ignore errors
        }
    }

    addMessage(content, type, isLoading = false) {
        return this.uiManager.addMessage(content, type, isLoading);
    }

    removeMessage(messageElement) {
        return this.uiManager.removeMessage(messageElement);
    }

    hideWelcomeScreen() {
        return this.uiManager.hideWelcomeScreen();
    }

    showWelcomeScreen() {
        return this.uiManager.showWelcomeScreen();
    }

    showInterimText(text) {
        return this.uiManager.showInterimText(text);
    }

    updateStreamingMessage(text) {
        return this.uiManager.updateStreamingMessage(text);
    }

    scrollToBottom() {
        return this.uiManager.scrollToBottom();
    }

    adjustTextareaHeight() {
        return this.uiManager.adjustTextareaHeight();
    }

    async saveState() {
        return this.uiManager.saveState();
    }

    // Event handling delegation methods
    initializeEventListeners() {
        return this.eventManager.initializeEventListeners();
    }

    initializeCrossWindowSync() {
        return this.eventManager.initializeCrossWindowSync();
    }

    async handleConversationUpdate() {
        return this.eventManager.handleConversationUpdate();
    }

    async refreshConversationUI() {
        return this.eventManager.refreshConversationUI();
    }

    updatePageInfo(pageInfo) {
        return this.eventManager.updatePageInfo(pageInfo);
    }

    async handleSendMessage() {
        return this.eventManager.handleSendMessage();
    }

    async processMessage(message) {
        return this.eventManager.processMessage(message);
    }

    async sendToBackground(message) {
        return this.eventManager.sendToBackground(message);
    }

    async handleClearChat() {
        return this.eventManager.handleClearChat();
    }

    async handleVoiceInput() {
        return this.eventManager.handleVoiceInput();
    }

    async startVoiceInput() {
        return this.eventManager.startVoiceInput();
    }

    async stopVoiceInput() {
        return this.eventManager.stopVoiceInput();
    }

    handleListeningStopped(reason) {
        return this.eventManager.handleListeningStopped(reason);
    }

    handleVoiceError(result) {
        return this.eventManager.handleVoiceError(result);
    }

    handleTranscriptionReceived(transcription) {
        return this.eventManager.handleTranscriptionReceived(transcription);
    }

    handleInterimTranscription(interimText) {
        return this.eventManager.handleInterimTranscription(interimText);
    }

    handleBotResponse(response) {
        return this.eventManager.handleBotResponse(response);
    }

    isErrorTranscription(transcription) {
        return this.eventManager.isErrorTranscription(transcription);
    }

    async handleExtensionReloaded() {
        return this.eventManager.handleExtensionReloaded();
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
                    const messageDiv = MessageRenderer.createMessage(
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
            if (this.audioHandler && this.audioHandler.screenCapture) {
                await this.audioHandler.screenCapture.cleanup();
            }
        } catch (error) {
            console.error("Error cleaning up debugger attachments:", error);
        }
    }
}
