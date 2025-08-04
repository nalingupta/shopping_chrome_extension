import { MESSAGE_TYPES } from '../utils/constants.js';
import { ChatStateManager } from '../utils/storage.js';
import { MessageRenderer } from '../ui/message-renderer.js';
import { UIState } from '../ui/ui-state.js';
import { AudioHandler } from '../services/audio-handler.js';

export class ShoppingAssistant {
    constructor() {
        this.uiState = new UIState();
        this.audioHandler = new AudioHandler();
        
        this.initializeElements();
        this.initializeEventListeners();
        this.initializeCallbacks();
        
        this.trackSidePanelLifecycle();
        this.checkHotReloadClear();
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
            welcomeScreen: document.getElementById("welcomeScreen")
        };
    }

    initializeEventListeners() {
        this.elements.sendButton.addEventListener("click", () => this.handleSendMessage());
        this.elements.voiceButton.addEventListener("click", () => this.handleVoiceInput());
        this.elements.clearChatButton.addEventListener("click", () => this.handleClearChat());

        this.elements.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.elements.userInput.addEventListener("input", () => {
            this.adjustTextareaHeight();
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === MESSAGE_TYPES.PAGE_INFO_BROADCAST) {
                this.updatePageInfo(request.data);
            }
        });
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
    }

    trackSidePanelLifecycle() {
        chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED }).catch(() => {});
        chrome.storage.local.set({ sidePanelOpen: true }).catch(() => {});

        const setSidePanelClosed = () => {
            chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_CLOSED }).catch(() => {});
            chrome.storage.local.set({ sidePanelOpen: false }).catch(() => {});
        };

        window.addEventListener('beforeunload', setSidePanelClosed);
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                setSidePanelClosed();
            } else {
                chrome.runtime.sendMessage({ type: MESSAGE_TYPES.SIDE_PANEL_OPENED }).catch(() => {});
                chrome.storage.local.set({ sidePanelOpen: true }).catch(() => {});
            }
        });
    }

    async checkHotReloadClear() {
        try {
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['clearChatOnNextLoad'], resolve);
            });
            
            if (result.clearChatOnNextLoad) {
                ChatStateManager.clearState();
                chrome.storage.local.remove(['clearChatOnNextLoad']);
            }
        } catch (error) {
            // Ignore errors
        }
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

        const loadingMessage = this.addMessage("Thinking...", "assistant", true);

        try {
            const response = await this.sendToBackground(message);
            this.removeMessage(loadingMessage);

            if (response.success) {
                this.addMessage(response.response, "assistant");
            } else {
                this.addMessage(
                    response.response || "Sorry, I encountered an error. Please try again.",
                    "assistant"
                );
            }
        } catch (error) {
            this.removeMessage(loadingMessage);
            this.addMessage("Sorry, I encountered an error. Please try again.", "assistant");
        } finally {
            this.uiState.setProcessing(false);
            this.elements.sendButton.disabled = false;
            this.elements.userInput.focus();
        }
    }

    async sendToBackground(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.PROCESS_USER_QUERY,
                data: {
                    query: message,
                    pageInfo: this.currentPageInfo,
                },
            }, resolve);
        });
    }

    addMessage(content, type, isLoading = false) {
        this.hideWelcomeScreen();
        
        const messageDiv = MessageRenderer.createMessage(content, type, isLoading);
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
        if (this.elements.welcomeScreen && !this.elements.welcomeScreen.classList.contains("hidden")) {
            this.elements.welcomeScreen.classList.add("hidden");
            this.uiState.clearStatus();
        }
    }

    showWelcomeScreen() {
        if (this.elements.welcomeScreen && this.elements.welcomeScreen.classList.contains("hidden")) {
            this.elements.welcomeScreen.classList.remove("hidden");
        }
        this.uiState.showStatus("Start a chat", "info");
    }

    handleClearChat() {
        this.elements.messages.innerHTML = "";
        MessageRenderer.clearInterimMessage();
        this.uiState.clearStatus();
        
        this.elements.userInput.value = "";
        this.adjustTextareaHeight();
        
        if (this.audioHandler.isListening()) {
            this.elements.voiceButton.classList.remove("listening");
            this.elements.voiceButton.title = "";
            this.audioHandler.stopListening();
        }
        
        this.showWelcomeScreen();
        this.uiState.setProcessing(false);
        this.elements.sendButton.disabled = false;
        ChatStateManager.clearState();
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
                this.elements.voiceButton.classList.add("listening");
                this.elements.voiceButton.title = "";
                this.uiState.showStatus("Listening...", "info");
            } else {
                this.handleVoiceError(result);
            }
        } catch (error) {
            console.error('Voice input error:', error);
            this.uiState.showTemporaryStatus("Voice failed", "error", 4000);
        }
    }

    async stopVoiceInput() {
        this.elements.voiceButton.classList.remove("listening");
        this.elements.voiceButton.title = "";
        await this.audioHandler.stopListening();
        MessageRenderer.clearInterimMessage();
        
        this.uiState.showStatus("Start a chat", "info");
    }

    handleVoiceError(result) {
        const shortMessages = {
            "permission_denied": "Mic denied",
            "permission_dismissed": "Mic dismissed", 
            "no_microphone": "No mic",
            "not_supported": "Not supported",
            "tab_capture_failed": "Unavailable here",
            "not_secure_context": "HTTPS required"
        };

        const shortMessage = shortMessages[result.error] || "Voice error";
        this.uiState.showTemporaryStatus(shortMessage, "error", 5000);
    }

    handleTranscriptionReceived(transcription) {
        if (transcription) {
            MessageRenderer.clearInterimMessage();

            if (this.isErrorTranscription(transcription)) {
                this.uiState.showStatus("Speech failed", "error", 4000);
                return;
            }

            this.addMessage(transcription, "user", false);
            
            if (!this.uiState.isProcessing) {
                this.uiState.showStatus("Processing with Gemini...", "info");
            }
        }
    }

    handleInterimTranscription(interimText) {
        if (interimText && this.audioHandler.isListening()) {
            this.showInterimText(interimText);
        }
    }

    handleBotResponse(response) {
        this.addMessage(response.text, "assistant");
        
        if (this.audioHandler.isListening()) {
            this.uiState.showStatus("Listening...", "info");
        }
    }

    showInterimText(text) {
        this.hideWelcomeScreen();
        
        let interimMessage = document.getElementById("interim-message");
        
        if (!interimMessage) {
            interimMessage = MessageRenderer.createInterimMessage(text);
            this.elements.messages.appendChild(interimMessage);
        } else {
            MessageRenderer.updateInterimMessage(text);
        }
        
        this.scrollToBottom();
    }

    isErrorTranscription(transcription) {
        return transcription.includes("Speech recognition failed") || 
               transcription.includes("Error processing audio");
    }


    scrollToBottom() {
        if (this.elements.messages) {
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
        }
    }

    adjustTextareaHeight() {
        const textarea = this.elements.userInput;
        const maxHeight = 80;
        
        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
        }
    }

    saveState() {
        const messages = Array.from(this.elements.messages.querySelectorAll('.message:not(.interim-message):not(.status-message)'))
            .map(msg => ({
                content: msg.querySelector('.message-content').textContent,
                type: msg.classList.contains('user-message') ? 'user' : 'assistant'
            }));
        
        const isWelcomeVisible = !this.elements.welcomeScreen || !this.elements.welcomeScreen.classList.contains("hidden");
        
        ChatStateManager.saveState(messages, isWelcomeVisible);
    }

    restoreState() {
        const state = ChatStateManager.restoreState();
        if (!state) {
            this.uiState.showStatus("Start a chat", "info");
            return;
        }

        if (state.messages && state.messages.length > 0) {
            state.messages.forEach(msg => {
                const messageDiv = MessageRenderer.createMessage(msg.content, msg.type);
                this.elements.messages.appendChild(messageDiv);
            });

            this.hideWelcomeScreen();
            this.scrollToBottom();
        } else if (!state.isWelcomeVisible) {
            this.hideWelcomeScreen();
        } else {
            this.uiState.showStatus("Start a chat", "info");
        }
    }
}