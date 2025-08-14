import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { ConversationRenderer } from "../ui/conversation-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { MultimediaOrchestrator } from "../services/multimedia-orchestrator.js";
import { AudioHandler } from "../services/audio-handler.js";
import { VideoHandler } from "../services/video-handler.js";
import { ServerClient } from "../services/ai/server-client.js";
import { UIManager } from "./ui-manager.js";
import { EventManager } from "./event-manager.js";
import { LifecycleManager } from "./lifecycle-manager.js";

export class ShoppingAssistant {
    constructor() {
        this.uiManager = new UIManager();

        // Create new handlers
        this.serverClient = new ServerClient();
        this.videoHandler = new VideoHandler(this.serverClient);
        this.audioHandler = new AudioHandler(
            this.serverClient,
            this.videoHandler
        );
        this.multimediaOrchestrator = new MultimediaOrchestrator(
            this.audioHandler,
            this.videoHandler,
            this.serverClient
        );

        this.eventManager = new EventManager(
            this.uiManager,
            this.multimediaOrchestrator
        );
        this.lifecycleManager = new LifecycleManager(
            this.uiManager,
            this.eventManager,
            this.multimediaOrchestrator,
            null
        );

        this.uiManager.initializeElements();
        this.eventManager.initializeEventListeners();
        this.initializeCallbacks();
        this.lifecycleManager.trackSidePanelLifecycle();
        this.lifecycleManager.checkAndClearChatHistoryOnReload();
        this.eventManager.initializeCrossWindowSync();
        this.lifecycleManager.restoreState();
    }

    initializeCallbacks() {
        // Set up MultimediaOrchestrator callbacks for voice/multimedia
        this.multimediaOrchestrator.setTranscriptionCallback(
            (transcription) => {
                this.handleTranscriptionReceived(transcription);
            }
        );

        this.multimediaOrchestrator.setInterimCallback((interimText) => {
            this.handleInterimTranscription(interimText);
        });

        this.multimediaOrchestrator.setBotResponseCallback((response) => {
            this.handleBotResponse(response);
        });

        this.multimediaOrchestrator.setStatusCallback(
            (status, type, duration) => {
                this.uiManager.uiState.showStatus(status, type, duration);
            }
        );

        this.multimediaOrchestrator.setListeningStoppedCallback((reason) => {
            this.handleListeningStopped(reason);
        });

        // Set up ServerClient callbacks for text message responses
        this.serverClient.setBotResponseCallback((response) => {
            this.handleBotResponse(response);
        });

        this.serverClient.setStreamingUpdateCallback((update) => {
            this.handleBotResponse(update);
        });

        this.serverClient.setConnectionStateCallback((state) => {
            if (state === "connected") {
                this.uiManager.uiState.showStatus(
                    "Connected to AI",
                    "success",
                    2000
                );
            } else if (state === "disconnected") {
                this.uiManager.uiState.showStatus(
                    "Disconnected from AI",
                    "error",
                    3000
                );
            }
        });

        this.serverClient.setErrorCallback((error) => {
            console.error("Server client error:", error);
            this.uiManager.uiState.showStatus(
                "AI connection error",
                "error",
                3000
            );
        });
    }

    // Page info request removed

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
