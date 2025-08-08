import { MessageRenderer } from "../ui/message-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { UnifiedConversationManager } from "../utils/storage.js";

export class UIManager {
    constructor(messageRenderer) {
        this.messageRenderer = messageRenderer;
        this.elements = {};
        this.uiState = new UIState();
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

    addMessage(content, type, isLoading = false) {
        this.hideWelcomeScreen();

        const messageDiv = this.messageRenderer.createMessage(
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

    showInterimText(text) {
        this.hideWelcomeScreen();

        // Clear any existing streaming messages when showing new interim text
        this.messageRenderer.clearStreamingMessage();

        let interimMessage = document.getElementById("interim-message");

        if (!interimMessage) {
            interimMessage = this.messageRenderer.createInterimMessage(text);
            this.elements.messages.appendChild(interimMessage);
        } else {
            this.messageRenderer.updateInterimMessage(text);
        }

        this.scrollToBottom();
    }

    updateStreamingMessage(text) {
        this.hideWelcomeScreen();

        let streamingMessage = document.getElementById("streaming-message");

        if (!streamingMessage) {
            // Create new streaming message
            streamingMessage =
                this.messageRenderer.createStreamingMessage(text);
            this.elements.messages.appendChild(streamingMessage);
        } else {
            // Update existing streaming message
            this.messageRenderer.updateStreamingMessage(text);
        }

        this.scrollToBottom();
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
}
