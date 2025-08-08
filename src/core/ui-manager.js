import { UIState } from "../ui/ui-state.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { BubbleLayoutManager } from "../ui/bubble-layout-manager.js";
import { TurnView } from "../ui/turn-view.js";
import { ConversationController } from "../ui/conversation-controller.js";

export class UIManager {
    constructor() {
        this.elements = {};
        this.uiState = new UIState();
        this.conversationRenderer = null; // legacy renderer retained temporarily
        this.layoutManager = null;
        this.turnView = null;
        this.controller = null;
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

        // Initialize layout manager (locks bubble width) and controller/view
        this.layoutManager = new BubbleLayoutManager();
        this.layoutManager.initialize(this.elements.messages);

        this.turnView = new TurnView(this.elements.messages);
        this.controller = new ConversationController(this.turnView);
    }

    addMessage(content, type, isLoading = false) {
        // Backward-compatible helper used by some flows (text send path)
        this.hideWelcomeScreen();
        if (this.conversationRenderer) {
            this.conversationRenderer.appendFinalMessage(type, content);
            this.saveState();
        }
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

    // New conversation UI delegates -------------------------------------------------
    setUserInterim(text) {
        this.hideWelcomeScreen();
        if (this.controller) {
            this.controller.onInterim(text);
        } else {
            this.conversationRenderer?.setUserInterim(text);
        }
    }

    finalizeUserInterim(finalText) {
        this.hideWelcomeScreen();
        if (this.controller) {
            this.controller.onUserFinal(finalText);
        } else {
            this.conversationRenderer?.finalizeUserInterim(finalText);
        }
        this.saveState();
    }

    startAssistantStream() {
        this.hideWelcomeScreen();
        // With controller, pending is ensured on first stream
    }

    updateAssistantStream(text) {
        this.hideWelcomeScreen();
        if (this.controller) {
            this.controller.onAssistantStream(text);
        } else {
            this.conversationRenderer?.updateAssistantStream(text);
        }
    }

    finalizeAssistantStream() {
        if (this.controller) {
            this.controller.onAssistantFinal();
        } else {
            this.conversationRenderer?.finalizeAssistantStream();
        }
        this.saveState();
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
        const messages = this.controller
            ? this.controller.getPersistableMessages()
            : this.conversationRenderer
            ? this.conversationRenderer.getHistory()
            : [];

        const isWelcomeVisible =
            !this.elements.welcomeScreen ||
            !this.elements.welcomeScreen.classList.contains("hidden");

        await UnifiedConversationManager.saveMessages(
            messages,
            isWelcomeVisible
        );
    }
}
