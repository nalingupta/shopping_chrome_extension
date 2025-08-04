import { MESSAGE_TYPES } from '../utils/constants.js';
import { DOMUtils, MessageRenderer } from '../utils/dom.js';
import { ChatStateManager } from '../utils/storage.js';
import { VoiceInputHandler } from '../services/voice-handler.js';

class ShoppingAssistant {
    constructor() {
        this.initializeElements();
        this.initializeState();
        this.initializeVoiceHandler();
        this.initializeEventListeners();
        
        this.trackSidePanelOpened();
        this.restoreState();
        this.getCurrentPageInfo();
    }

    initializeElements() {
        this.messagesContainer = DOMUtils.getElementById("messages");
        this.userInput = DOMUtils.getElementById("userInput");
        this.sendButton = DOMUtils.getElementById("sendButton");
        this.voiceButton = DOMUtils.getElementById("voiceButton");
        this.clearChatButton = DOMUtils.getElementById("clearChatButton");
    }

    initializeState() {
        this.currentPageInfo = null;
        this.isProcessing = false;
    }

    initializeVoiceHandler() {
        this.voiceHandler = new VoiceInputHandler();
        
        this.voiceHandler.setTranscriptionCallback((transcription) => {
            this.handleTranscriptionReceived(transcription);
        });

        this.voiceHandler.setInterimCallback((interimText) => {
            this.handleInterimTranscription(interimText);
        });
    }

    trackSidePanelOpened() {
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

    initializeEventListeners() {
        this.sendButton.addEventListener("click", () => this.handleSendMessage());
        this.voiceButton.addEventListener("click", () => this.handleVoiceInput());
        this.clearChatButton.addEventListener("click", () => this.handleClearChat());

        this.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.userInput.addEventListener("input", () => {
            DOMUtils.adjustTextareaHeight(this.userInput);
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === MESSAGE_TYPES.PAGE_INFO_BROADCAST) {
                this.updatePageInfo(request.data);
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
        }
    }

    updatePageInfo(pageInfo) {
        this.currentPageInfo = pageInfo;
    }

    async handleSendMessage() {
        const message = this.userInput.value.trim();
        if (!message || this.isProcessing) return;

        this.addMessage(message, "user");
        this.userInput.value = "";
        DOMUtils.adjustTextareaHeight(this.userInput);

        await this.processMessage(message);
    }

    async processMessage(message) {
        this.isProcessing = true;
        this.sendButton.disabled = true;

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
            this.isProcessing = false;
            this.sendButton.disabled = false;
            this.userInput.focus();
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
        this.messagesContainer.appendChild(messageDiv);

        DOMUtils.scrollToBottom(this.messagesContainer);

        if (!isLoading) {
            this.saveState();
        }

        return messageDiv;
    }

    removeMessage(messageElement) {
        DOMUtils.removeElement(messageElement);
    }

    hideWelcomeScreen() {
        const welcomeScreen = DOMUtils.getElementById("welcomeScreen");
        if (welcomeScreen && !welcomeScreen.classList.contains("hidden")) {
            welcomeScreen.classList.add("hidden");
        }
    }

    showWelcomeScreen() {
        const welcomeScreen = DOMUtils.getElementById("welcomeScreen");
        if (welcomeScreen && welcomeScreen.classList.contains("hidden")) {
            welcomeScreen.classList.remove("hidden");
        }
    }

    handleClearChat() {
        this.messagesContainer.innerHTML = "";
        MessageRenderer.clearInterimMessage();
        
        this.userInput.value = "";
        DOMUtils.adjustTextareaHeight(this.userInput);
        
        if (this.voiceHandler.state.isListening) {
            this.voiceButton.classList.remove("listening");
            this.voiceButton.title = "Click to start voice conversation";
            this.voiceHandler.stopListening();
        }
        
        this.showWelcomeScreen();
        this.resetProcessingState();
        ChatStateManager.clearState();
        this.userInput.focus();
    }

    resetProcessingState() {
        this.isProcessing = false;
        this.sendButton.disabled = false;
    }

    async handleVoiceInput() {
        if (this.voiceHandler.state.isListening) {
            await this.stopVoiceInput();
        } else {
            await this.startVoiceInput();
        }
    }

    async startVoiceInput() {
        const result = await this.voiceHandler.startListening();
        if (result.success) {
            this.voiceButton.classList.add("listening");
            this.voiceButton.title = "Click to stop voice conversation";
        } else {
            this.handleVoiceError(result);
        }
    }

    async stopVoiceInput() {
        this.voiceButton.classList.remove("listening");
        this.voiceButton.title = "Click to start voice conversation";
        await this.voiceHandler.stopListening();
        MessageRenderer.clearInterimMessage();
    }

    handleVoiceError(result) {
        let errorMessage = this.getVoiceErrorMessage(result);
        this.addMessage(errorMessage, "assistant");
    }

    getVoiceErrorMessage(result) {
        const errorMessages = {
            "permission_denied": result.help || "Microphone access denied. Please allow microphone permissions for this extension.",
            "permission_dismissed": result.help || "Microphone permission was dismissed. Please click the microphone button again and allow access when prompted.",
            "no_microphone": result.help || "No microphone found. Please connect a microphone and try again.",
            "not_supported": result.help || "Voice input is not supported in this browser context. Please try updating Chrome.",
            "tab_capture_failed": result.help || "Voice input is not available on this page. Please try navigating to a different website.",
            "not_secure_context": "Microphone access requires a secure website (HTTPS). Please navigate to a secure website."
        };

        return errorMessages[result.error] || result.help || "Unable to access microphone. Error: " + (result.details || result.error);
    }

    handleTranscriptionReceived(transcription) {
        if (transcription) {
            MessageRenderer.clearInterimMessage();

            if (this.isErrorTranscription(transcription)) {
                this.addMessage(transcription, "assistant");
                return;
            }

            this.addMessage(transcription, "user");
            this.processVoiceMessage(transcription);
        }
    }

    isErrorTranscription(transcription) {
        return transcription.includes("Speech recognition failed") || 
               transcription.includes("Error processing audio");
    }

    handleInterimTranscription(interimText) {
        if (interimText && this.voiceHandler.state.isListening) {
            this.showInterimText(interimText);
        }
    }

    showInterimText(text) {
        this.hideWelcomeScreen();
        
        let interimMessage = document.getElementById("interim-message");
        
        if (!interimMessage) {
            interimMessage = MessageRenderer.createInterimMessage(text);
            this.messagesContainer.appendChild(interimMessage);
        } else {
            MessageRenderer.updateInterimMessage(text);
        }
        
        DOMUtils.scrollToBottom(this.messagesContainer);
    }

    async processVoiceMessage(message) {
        this.voiceHandler.notifyResponseProcessing(true);
        await this.processMessage(message);
        this.voiceHandler.notifyResponseProcessing(false);
    }

    saveState() {
        const messages = Array.from(this.messagesContainer.querySelectorAll('.message:not(.interim-message)'))
            .map(msg => ({
                content: msg.querySelector('.message-content').textContent,
                type: msg.classList.contains('user-message') ? 'user' : 'assistant'
            }));
        
        const welcomeScreen = DOMUtils.getElementById("welcomeScreen");
        const isWelcomeVisible = !welcomeScreen || !welcomeScreen.classList.contains("hidden");
        
        ChatStateManager.saveState(messages, isWelcomeVisible);
    }

    restoreState() {
        const state = ChatStateManager.restoreState();
        if (!state) return;

        if (state.messages && state.messages.length > 0) {
            state.messages.forEach(msg => {
                const messageDiv = MessageRenderer.createMessage(msg.content, msg.type);
                this.messagesContainer.appendChild(messageDiv);
            });

            this.hideWelcomeScreen();
            DOMUtils.scrollToBottom(this.messagesContainer);
        } else if (!state.isWelcomeVisible) {
            this.hideWelcomeScreen();
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new ShoppingAssistant();
});