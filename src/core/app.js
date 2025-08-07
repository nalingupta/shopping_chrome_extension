import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { MessageRenderer } from "../ui/message-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { AudioHandler } from "../services/audio-handler.js";

export class ShoppingAssistant {
    constructor() {
        this.elements = {};
        this.uiState = new UIState();
        this.audioHandler = new AudioHandler();
        this.currentPageInfo = null;

        this.initializeElements();
        this.initializeEventListeners();
        this.initializeCallbacks();
        this.trackSidePanelLifecycle();
        this.checkAndClearChatHistoryOnReload();
        this.initializeCrossWindowSync();
        this.restoreState();
        this.getCurrentPageInfo();
    }

    initializeElements() {
        this.elements = {
            messages: document.getElementById("messages"),
            userInput: document.getElementById("userInput"),
            sendButton: document.getElementById("sendButton"),
            voiceButton: document.getElementById("voiceButton"),
            clearChatButton: document.getElementById("clearChatButton"),
            headerStatus: document.getElementById("headerStatus"),
            welcomeScreen: document.getElementById("welcomeScreen"),
        };
    }

    initializeEventListeners() {
        this.elements.sendButton.addEventListener("click", () =>
            this.handleSendMessage()
        );
        this.elements.voiceButton.addEventListener("click", () =>
            this.handleVoiceInput()
        );
        this.elements.clearChatButton.addEventListener("click", () =>
            this.handleClearChat()
        );

        this.elements.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.elements.userInput.addEventListener("input", () => {
            this.adjustTextareaHeight();
        });

        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (request.type === MESSAGE_TYPES.PAGE_INFO_BROADCAST) {
                    this.updatePageInfo(request.data);
                } else if (
                    request.type === MESSAGE_TYPES.CONVERSATION_UPDATED
                ) {
                    // Handle cross-window conversation updates
                    this.handleConversationUpdate();
                }
            }
        );

        // Listen for storage changes to detect extension reloads
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === "local" && changes.extensionReloaded) {
                this.handleExtensionReloaded();
            }
        });

        // Handle window resize for preview canvas
        window.addEventListener("resize", () => {
            if (this.audioHandler.previewManager) {
                this.audioHandler.previewManager.resize();
            }
        });
    }

    initializeCrossWindowSync() {
        // Set up conversation change listener for cross-window synchronization
        UnifiedConversationManager.addConversationListener((conversation) => {
            this.handleConversationUpdate();
        });
    }

    async handleConversationUpdate() {
        try {
            // Refresh the UI with latest conversation data
            await this.refreshConversationUI();
        } catch (error) {
            console.error("Error handling conversation update:", error);
        }
    }

    async refreshConversationUI() {
        try {
            // Get latest messages from unified storage
            const messages =
                await UnifiedConversationManager.getMessagesForUI();
            const isWelcomeVisible =
                await UnifiedConversationManager.getWelcomeScreenState();

            // Clear current UI
            this.elements.messages.innerHTML = "";

            // Restore messages
            if (messages && messages.length > 0) {
                messages.forEach((msg) => {
                    const messageDiv = MessageRenderer.createMessage(
                        msg.content,
                        msg.type
                    );
                    this.elements.messages.appendChild(messageDiv);
                });

                this.hideWelcomeScreen();
                this.scrollToBottom();
            } else if (!isWelcomeVisible) {
                this.hideWelcomeScreen();
            } else {
                this.uiState.showStatus("Start a chat", "info");
            }
        } catch (error) {
            console.error("Error refreshing conversation UI:", error);
        }
    }

    initializeCallbacks() {
        this.audioHandler.setTranscriptionCallback((transcription) => {
            this.handleTranscriptionReceived(transcription);
        });

        this.audioHandler.setInterimCallback((interimText) => {
            this.handleInterimTranscription(interimText);
        });

        this.audioHandler.setBotResponseCallback((response) => {
            this.handleBotResponse(response);
        });

        this.audioHandler.setStatusCallback((status, type, duration) => {
            this.uiState.showStatus(status, type, duration);
        });

        this.audioHandler.setListeningStoppedCallback((reason) => {
            this.handleListeningStopped(reason);
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
                await this.stopVoiceInput();
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
                this.updatePageInfo(response);
            }
        } catch (error) {
            // Ignore errors
        }
    }

    updatePageInfo(pageInfo) {
        this.currentPageInfo = pageInfo;
    }

    async handleSendMessage() {
        const message = this.elements.userInput.value.trim();
        if (!message || this.uiState.isProcessing) return;

        this.addMessage(message, "user");
        this.elements.userInput.value = "";
        this.adjustTextareaHeight();

        await this.processMessage(message);
    }

    async processMessage(message) {
        this.uiState.setProcessing(true);
        this.elements.sendButton.disabled = true;

        const loadingMessage = this.addMessage(
            "Thinking...",
            "assistant",
            true
        );

        try {
            const response = await this.sendToBackground(message);
            this.removeMessage(loadingMessage);

            if (response.success) {
                this.addMessage(response.response, "assistant");
            } else {
                this.addMessage(
                    response.response ||
                        "Sorry, I encountered an error. Please try again.",
                    "assistant"
                );
            }
        } catch (error) {
            this.removeMessage(loadingMessage);
            this.addMessage(
                "Sorry, I encountered an error. Please try again.",
                "assistant"
            );
        } finally {
            this.uiState.setProcessing(false);
            this.elements.sendButton.disabled = false;
            this.elements.userInput.focus();
        }
    }

    async sendToBackground(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                {
                    type: MESSAGE_TYPES.PROCESS_USER_QUERY,
                    data: {
                        query: message,
                        pageInfo: this.currentPageInfo,
                    },
                },
                resolve
            );
        });
    }

    addMessage(content, type, isLoading = false) {
        this.hideWelcomeScreen();

        const messageDiv = MessageRenderer.createMessage(
            content,
            type,
            isLoading
        );
        this.elements.messages.appendChild(messageDiv);

        this.scrollToBottom();

        if (!isLoading) {
            this.saveState();
        }

        return messageDiv;
    }

    removeMessage(messageElement) {
        if (messageElement && messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }

    hideWelcomeScreen() {
        if (
            this.elements.welcomeScreen &&
            !this.elements.welcomeScreen.classList.contains("hidden")
        ) {
            this.elements.welcomeScreen.classList.add("hidden");
            this.uiState.clearStatus();
        }
    }

    showWelcomeScreen() {
        if (
            this.elements.welcomeScreen &&
            this.elements.welcomeScreen.classList.contains("hidden")
        ) {
            this.elements.welcomeScreen.classList.remove("hidden");
        }
        this.uiState.showStatus("Start a chat", "info");
    }

    async handleClearChat() {
        this.elements.messages.innerHTML = "";
        MessageRenderer.clearInterimMessage();
        MessageRenderer.clearStreamingMessage();
        this.uiState.clearStatus();

        this.elements.userInput.value = "";
        this.adjustTextareaHeight();

        if (this.audioHandler.isListening()) {
            this.elements.voiceButton.classList.remove("listening");
            this.elements.voiceButton.title = "";
            this.audioHandler.stopListening();
        }

        // Reset speech state
        this.uiState.setSpeechState("idle");

        this.showWelcomeScreen();
        this.uiState.setProcessing(false);
        this.elements.sendButton.disabled = false;

        // Clear conversation using unified manager
        await UnifiedConversationManager.clearConversation();

        this.elements.userInput.focus();
    }

    async handleVoiceInput() {
        if (this.audioHandler.isListening()) {
            await this.stopVoiceInput();
        } else {
            await this.startVoiceInput();
        }
    }

    async startVoiceInput() {
        try {
            const result = await this.audioHandler.startListening();
            if (result.success) {
                this.hideWelcomeScreen();
                this.elements.voiceButton.classList.add("listening");
                this.elements.voiceButton.title = "";
                this.uiState.setSpeechState("listening");
                this.uiState.showStatus("Listening...", "info");
            } else {
                this.handleVoiceError(result);
            }
        } catch (error) {
            console.error("Voice input error:", error);
            this.uiState.showTemporaryStatus("Voice failed", "error", 4000);
        }
    }

    async stopVoiceInput() {
        this.elements.voiceButton.classList.remove("listening");
        this.elements.voiceButton.title = "";
        await this.audioHandler.stopListening();
        MessageRenderer.clearInterimMessage();

        this.uiState.setSpeechState("idle");
        this.uiState.showStatus("Start a chat", "info");
    }

    handleListeningStopped(reason) {
        // Reset UI state when listening stops due to external factors
        this.elements.voiceButton.classList.remove("listening");
        this.elements.voiceButton.title = "";
        MessageRenderer.clearInterimMessage();

        this.uiState.setSpeechState("idle");

        // Show appropriate message based on reason
        switch (reason) {
            case "screen_capture_failed":
                this.uiState.showStatus(
                    "Screen capture failed - listening stopped",
                    "error"
                );
                break;
            case "setup_failed":
                this.uiState.showStatus(
                    "Setup failed - please try again",
                    "error"
                );
                break;
            case "debugger_detached":
                this.uiState.showStatus(
                    "Screen capture cancelled - listening stopped",
                    "error"
                );
                break;
            default:
                this.uiState.showStatus("Listening stopped", "info");
        }
    }

    handleVoiceError(result) {
        const shortMessages = {
            permission_denied: "Mic denied",
            permission_dismissed: "Mic dismissed",
            no_microphone: "No mic",
            not_supported: "Not supported",
            tab_capture_failed: "Unavailable here",
            not_secure_context: "HTTPS required",
        };

        const shortMessage = shortMessages[result.error] || "Voice error";
        this.uiState.showTemporaryStatus(shortMessage, "error", 5000);
    }

    handleTranscriptionReceived(transcription) {
        if (transcription) {
            MessageRenderer.clearInterimMessage();
            MessageRenderer.clearStreamingMessage(); // Clear any existing streaming messages

            if (this.isErrorTranscription(transcription)) {
                this.uiState.showStatus("Speech failed", "error", 4000);
                this.uiState.setSpeechState("idle");
                return;
            }

            this.addMessage(transcription, "user", false);

            // Set processing state when user message is finalized
            this.uiState.setSpeechState("processing");
            this.uiState.showStatus("Processing with Gemini...", "info");
        }
    }

    handleInterimTranscription(interimText) {
        if (interimText && this.audioHandler.isListening()) {
            this.showInterimText(interimText);
        }
    }

    handleBotResponse(response) {
        // Set responding state when bot starts responding
        this.uiState.setSpeechState("responding");

        if (response.isStreaming) {
            // Handle streaming update (ChatGPT-style)
            this.updateStreamingMessage(response.text);
        } else {
            // Handle final response - finalize streaming message
            // The streaming message already contains the full text,
            // so we just need to finalize its appearance.

            MessageRenderer.finalizeStreamingMessage();

            // Ensure final scroll to bottom
            this.scrollToBottom();

            // Save the finalized message to chat history
            this.saveState();

            // Return to listening state if still listening, otherwise idle
            if (this.audioHandler.isListening()) {
                this.uiState.setSpeechState("listening");
                this.uiState.showStatus("Listening...", "info");
            } else {
                this.uiState.setSpeechState("idle");
            }
        }
    }

    showInterimText(text) {
        this.hideWelcomeScreen();

        // Clear any existing streaming messages when showing new interim text
        MessageRenderer.clearStreamingMessage();

        let interimMessage = document.getElementById("interim-message");

        if (!interimMessage) {
            interimMessage = MessageRenderer.createInterimMessage(text);
            this.elements.messages.appendChild(interimMessage);
        } else {
            MessageRenderer.updateInterimMessage(text);
        }

        this.scrollToBottom();
    }

    updateStreamingMessage(text) {
        this.hideWelcomeScreen();

        let streamingMessage = document.getElementById("streaming-message");

        if (!streamingMessage) {
            // Create new streaming message
            streamingMessage = MessageRenderer.createStreamingMessage(text);
            this.elements.messages.appendChild(streamingMessage);
        } else {
            // Update existing streaming message
            MessageRenderer.updateStreamingMessage(text);
        }

        this.scrollToBottom();
    }

    isErrorTranscription(transcription) {
        return (
            transcription.includes("Speech recognition failed") ||
            transcription.includes("Error processing audio")
        );
    }

    scrollToBottom() {
        if (this.elements.messages) {
            this.elements.messages.scrollTop =
                this.elements.messages.scrollHeight;
        }
    }

    adjustTextareaHeight() {
        const textarea = this.elements.userInput;
        const maxHeight = 80;

        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height =
                Math.min(textarea.scrollHeight, maxHeight) + "px";
        }
    }

    async saveState() {
        const messages = Array.from(
            this.elements.messages.querySelectorAll(
                ".message:not(.interim-message):not(.status-message):not(.streaming-message)"
            )
        ).map((msg) => ({
            content: msg.querySelector(".message-content").textContent,
            type: msg.classList.contains("user-message") ? "user" : "assistant",
        }));

        const isWelcomeVisible =
            !this.elements.welcomeScreen ||
            !this.elements.welcomeScreen.classList.contains("hidden");

        // Save using unified manager
        await UnifiedConversationManager.saveMessages(
            messages,
            isWelcomeVisible
        );
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
            this.elements.messages.innerHTML = "";
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
                    const messageDiv = MessageRenderer.createMessage(
                        msg.content,
                        msg.type
                    );
                    this.elements.messages.appendChild(messageDiv);
                });

                this.hideWelcomeScreen();
                this.scrollToBottom();
            } else if (!isWelcomeVisible) {
                this.hideWelcomeScreen();
            } else {
                this.uiState.showStatus("Start a chat", "info");
            }
        } catch (error) {
            console.error("Error restoring state:", error);
            this.uiState.showStatus("Start a chat", "info");
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
