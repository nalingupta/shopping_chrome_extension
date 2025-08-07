import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { MessageRenderer } from "../ui/message-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { AudioHandler } from "../services/audio-handler.js";
import { UIManager } from "./ui-manager.js";
import { EventManager } from "./event-manager.js";
import { LifecycleManager } from "./lifecycle-manager.js";

export class ShoppingAssistant {
    constructor() {
        this.messageRenderer = new MessageRenderer();
        this.uiManager = new UIManager(this.messageRenderer);
        this.audioHandler = new AudioHandler();
        this.eventManager = new EventManager(
            this.uiManager,
            this.audioHandler,
            this.messageRenderer
        );
        this.lifecycleManager = new LifecycleManager(
            this.uiManager,
            this.eventManager,
            this.audioHandler,
            this.messageRenderer
        );

        this.uiManager.initializeElements();
        this.eventManager.initializeEventListeners();
        this.initializeCallbacks();
        this.lifecycleManager.trackSidePanelLifecycle();
        this.lifecycleManager.checkAndClearChatHistoryOnReload();
        this.eventManager.initializeCrossWindowSync();
        this.lifecycleManager.restoreState();
        this.getCurrentPageInfo();
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
            this.uiManager.uiState.showStatus(status, type, duration);
        });

        this.audioHandler.setListeningStoppedCallback((reason) => {
            this.handleListeningStopped(reason);
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

    // Audio handler callback methods - maintain proper context
    handleTranscriptionReceived(transcription) {
        return this.eventManager.handleTranscriptionReceived(transcription);
    }

    handleInterimTranscription(interimText) {
        return this.eventManager.handleInterimTranscription(interimText);
    }

    handleBotResponse(response) {
        return this.eventManager.handleBotResponse(response);
    }

    handleListeningStopped(reason) {
        return this.eventManager.handleListeningStopped(reason);
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

    // Lifecycle management delegation methods

    trackSidePanelLifecycle() {
        return this.lifecycleManager.trackSidePanelLifecycle();
    }

    updatePageInfo(pageInfo) {
        return this.lifecycleManager.updatePageInfo(pageInfo);
    }

    async saveState() {
        return this.lifecycleManager.saveState();
    }

    async checkAndClearChatHistoryOnReload() {
        return this.lifecycleManager.checkAndClearChatHistoryOnReload();
    }

    async getExtensionReloadedMarker() {
        return this.lifecycleManager.getExtensionReloadedMarker();
    }

    async clearExtensionReloadedMarker() {
        return this.lifecycleManager.clearExtensionReloadedMarker();
    }

    async getLastChatSavedTime() {
        return this.lifecycleManager.getLastChatSavedTime();
    }

    async restoreState() {
        return this.lifecycleManager.restoreState();
    }

    async cleanupDebuggerAttachments() {
        return this.lifecycleManager.cleanupDebuggerAttachments();
    }

    // Property accessors for backward compatibility
    get currentPageInfo() {
        return this.eventManager.currentPageInfo;
    }
}
