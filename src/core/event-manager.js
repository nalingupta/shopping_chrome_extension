import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { MessageRenderer } from "../ui/message-renderer.js";

export class EventManager {
    constructor(uiManager, audioHandler) {
        this.uiManager = uiManager;
        this.audioHandler = audioHandler;
        this.currentPageInfo = null;
    }

    initializeEventListeners() {
        this.uiManager.elements.sendButton.addEventListener("click", () =>
            this.handleSendMessage()
        );
        this.uiManager.elements.voiceButton.addEventListener("click", () =>
            this.handleVoiceInput()
        );
        this.uiManager.elements.clearChatButton.addEventListener("click", () =>
            this.handleClearChat()
        );

        this.uiManager.elements.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.uiManager.elements.userInput.addEventListener("input", () => {
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
            this.uiManager.elements.messages.innerHTML = "";

            // Restore messages
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
            console.error("Error refreshing conversation UI:", error);
        }
    }

    updatePageInfo(pageInfo) {
        this.currentPageInfo = pageInfo;
    }

    async handleSendMessage() {
        const message = this.uiManager.elements.userInput.value.trim();
        if (!message || this.uiManager.uiState.isProcessing) return;

        this.addMessage(message, "user");
        this.uiManager.elements.userInput.value = "";
        this.adjustTextareaHeight();

        await this.processMessage(message);
    }

    async processMessage(message) {
        this.uiManager.uiState.setProcessing(true);
        this.uiManager.elements.sendButton.disabled = true;

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
            this.uiManager.uiState.setProcessing(false);
            this.uiManager.elements.sendButton.disabled = false;
            this.uiManager.elements.userInput.focus();
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

    async handleClearChat() {
        this.uiManager.elements.messages.innerHTML = "";
        MessageRenderer.clearInterimMessage();
        MessageRenderer.clearStreamingMessage();
        this.uiManager.uiState.clearStatus();

        this.uiManager.elements.userInput.value = "";
        this.adjustTextareaHeight();

        if (this.audioHandler.isListening()) {
            this.uiManager.elements.voiceButton.classList.remove("listening");
            this.uiManager.elements.voiceButton.title = "";
            this.audioHandler.stopListening();
        }

        // Reset speech state
        this.uiManager.uiState.setSpeechState("idle");

        this.showWelcomeScreen();
        this.uiManager.uiState.setProcessing(false);
        this.uiManager.elements.sendButton.disabled = false;

        // Clear conversation using unified manager
        await UnifiedConversationManager.clearConversation();

        this.uiManager.elements.userInput.focus();
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
                this.uiManager.elements.voiceButton.classList.add("listening");
                this.uiManager.elements.voiceButton.title = "";
                this.uiManager.uiState.setSpeechState("listening");
                this.uiManager.uiState.showStatus("Listening...", "info");
            } else {
                this.handleVoiceError(result);
            }
        } catch (error) {
            console.error("Voice input error:", error);
            this.uiManager.uiState.showTemporaryStatus(
                "Voice failed",
                "error",
                4000
            );
        }
    }

    async stopVoiceInput() {
        this.uiManager.elements.voiceButton.classList.remove("listening");
        this.uiManager.elements.voiceButton.title = "";
        await this.audioHandler.stopListening();
        MessageRenderer.clearInterimMessage();

        this.uiManager.uiState.setSpeechState("idle");
        this.uiManager.uiState.showStatus("Start a chat", "info");
    }

    handleListeningStopped(reason) {
        // Reset UI state when listening stops due to external factors
        this.uiManager.elements.voiceButton.classList.remove("listening");
        this.uiManager.elements.voiceButton.title = "";
        MessageRenderer.clearInterimMessage();

        this.uiManager.uiState.setSpeechState("idle");

        // Show appropriate message based on reason
        switch (reason) {
            case "screen_capture_failed":
                this.uiManager.uiState.showStatus(
                    "Screen capture failed - listening stopped",
                    "error"
                );
                break;
            case "setup_failed":
                this.uiManager.uiState.showStatus(
                    "Setup failed - please try again",
                    "error"
                );
                break;
            case "debugger_detached":
                this.uiManager.uiState.showStatus(
                    "Screen capture cancelled - listening stopped",
                    "error"
                );
                break;
            default:
                this.uiManager.uiState.showStatus("Listening stopped", "info");
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
        this.uiManager.uiState.showTemporaryStatus(shortMessage, "error", 5000);
    }

    handleTranscriptionReceived(transcription) {
        if (transcription) {
            MessageRenderer.clearInterimMessage();
            MessageRenderer.clearStreamingMessage(); // Clear any existing streaming messages

            if (this.isErrorTranscription(transcription)) {
                this.uiManager.uiState.showStatus(
                    "Speech failed",
                    "error",
                    4000
                );
                this.uiManager.uiState.setSpeechState("idle");
                return;
            }

            this.addMessage(transcription, "user", false);

            // Set processing state when user message is finalized
            this.uiManager.uiState.setSpeechState("processing");
            this.uiManager.uiState.showStatus(
                "Processing with Gemini...",
                "info"
            );
        }
    }

    handleInterimTranscription(interimText) {
        if (interimText && this.audioHandler.isListening()) {
            this.showInterimText(interimText);
        }
    }

    handleBotResponse(response) {
        // Set responding state when bot starts responding
        this.uiManager.uiState.setSpeechState("responding");

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
                this.uiManager.uiState.setSpeechState("listening");
                this.uiManager.uiState.showStatus("Listening...", "info");
            } else {
                this.uiManager.uiState.setSpeechState("idle");
            }
        }
    }

    isErrorTranscription(transcription) {
        return (
            transcription.includes("Speech recognition failed") ||
            transcription.includes("Error processing audio")
        );
    }

    // UI delegation methods
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

    async handleExtensionReloaded() {
        try {
            await UnifiedConversationManager.clearConversation();
            this.uiManager.elements.messages.innerHTML = "";
            this.showWelcomeScreen();
        } catch (error) {
            // Ignore errors
        }
    }
}
