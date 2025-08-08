import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";

export class EventManager {
    constructor(uiManager, multimediaOrchestrator) {
        this.uiManager = uiManager;
        this.multimediaOrchestrator = multimediaOrchestrator;
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
            // Preview manager is now handled by VideoHandler
            // This will be updated in Phase 3 when we fully integrate
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
            // Refresh the UI with latest conversation data (append-only)
            await this.refreshConversationUI();
        } catch (error) {
            console.error("Error handling conversation update:", error);
        }
    }

    async refreshConversationUI() {
        try {
            // Append-only restore using the new renderer
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
            console.error("Error refreshing conversation UI:", error);
        }
    }

    updatePageInfo(pageInfo) {
        this.currentPageInfo = pageInfo;
        // Share page info with AI so it can include it in context assembly
        try {
            this.multimediaOrchestrator?.aiHandler?.setCurrentPageInfo(
                pageInfo
            );
        } catch (_) {}
    }

    async handleSendMessage() {
        const message = this.uiManager.elements.userInput.value.trim();
        if (!message || this.uiManager.uiState.isProcessing) return;

        // Begin a new turn via controller: interim then finalize to set anchor
        this.uiManager.setUserInterim(message);
        this.uiManager.finalizeUserInterim(message);
        this.uiManager.elements.userInput.value = "";
        this.adjustTextareaHeight();

        await this.processMessage(message);
    }

    async processMessage(message) {
        this.uiManager.uiState.setProcessing(true);
        this.uiManager.elements.sendButton.disabled = true;

        try {
            // Send text message directly to AIHandler
            const result =
                await this.multimediaOrchestrator.aiHandler.sendTextMessage(
                    message
                );

            if (!result.success) {
                this.addMessage(
                    "Sorry, I encountered an error. Please try again.",
                    "assistant"
                );
            }
        } catch (error) {
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

    // sendToBackground method removed - now using AIHandler directly for text messages

    async handleClearChat() {
        this.uiManager.elements.messages.innerHTML = "";
        this.uiManager.conversationRenderer?.reset();
        this.uiManager.uiState.clearStatus();

        this.uiManager.elements.userInput.value = "";
        this.adjustTextareaHeight();

        if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
            this.uiManager.elements.voiceButton.classList.remove("listening");
            this.uiManager.elements.voiceButton.title = "";
            this.multimediaOrchestrator.stopMultimedia();
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
        if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
            await this.stopVoiceInput();
        } else {
            await this.startVoiceInput();
        }
    }

    async startVoiceInput() {
        try {
            const result = await this.multimediaOrchestrator.startMultimedia();
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
        await this.multimediaOrchestrator.stopMultimedia();
        // Clear any live UI buffers
        this.uiManager.conversationRenderer?.reset();

        this.uiManager.uiState.setSpeechState("idle");
        this.uiManager.uiState.showStatus("Start a chat", "info");
    }

    handleListeningStopped(reason) {
        // Reset UI state when listening stops due to external factors
        this.uiManager.elements.voiceButton.classList.remove("listening");
        this.uiManager.elements.voiceButton.title = "";
        // Clear any live UI buffers
        this.uiManager.conversationRenderer?.reset();

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
            // Finalize the current user interim into a finalized bubble, snap to top
            // and prepare assistant pending state

            if (this.isErrorTranscription(transcription)) {
                this.uiManager.uiState.showStatus(
                    "Speech failed",
                    "error",
                    4000
                );
                this.uiManager.uiState.setSpeechState("idle");
                return;
            }

            this.uiManager.finalizeUserInterim(transcription);

            // Set processing state when user message is finalized
            this.uiManager.uiState.setSpeechState("processing");
            this.uiManager.uiState.showStatus(
                "Processing with Gemini...",
                "info"
            );
        }
    }

    handleInterimTranscription(interimText) {
        if (
            interimText &&
            this.multimediaOrchestrator.isMultimediaSessionActive()
        ) {
            try {
                console.debug(
                    `[EventManager] interim received len=${interimText.length}`
                );
            } catch (_) {}
            this.uiManager.setUserInterim(interimText);
        }
    }

    handleBotResponse(response) {
        // Set responding state when bot starts responding
        this.uiManager.uiState.setSpeechState("responding");

        if (response.isStreaming) {
            // Controller ensures pending on first stream; just update
            this.uiManager.updateAssistantStream(response.text);
        } else {
            // Finalize assistant stream; if no stream existed, append directly
            if (response.text) {
                this.uiManager.updateAssistantStream(response.text);
                this.uiManager.finalizeAssistantStream();
            }

            // Save the finalized message to chat history
            this.saveState();

            // Return to listening state if still listening, otherwise idle
            if (this.multimediaOrchestrator.isMultimediaSessionActive()) {
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
        // Deprecated
        this.uiManager.setUserInterim(text);
    }

    updateStreamingMessage(text) {
        this.uiManager.updateAssistantStream(text);
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
