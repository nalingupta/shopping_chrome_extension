import { MESSAGE_TYPES } from "../utils/constants.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { ConversationRenderer } from "../ui/conversation-renderer.js";
import { UIState } from "../ui/ui-state.js";
import { MultimediaOrchestrator } from "../services/multimedia-orchestrator.js";
import { AudioHandler } from "../services/audio-handler.js";
import { VideoHandler } from "../services/video-handler.js";
import { ServerClient } from "../services/ai/server-client.js";
import { SharedServerClientProxy } from "../services/ai/shared-server-client-proxy.js";
import { UIManager } from "./ui-manager.js";
import { EventManager } from "./event-manager.js";
import { LifecycleManager } from "./lifecycle-manager.js";
// Debug logging removed after verification

export class ShoppingAssistant {
    constructor() {
        this.uiManager = new UIManager();

        // Create new handlers
        // Phase 3: establish a Port to background and fetch session info (no media forwarding yet)
        try {
            this.sharedProxy = new SharedServerClientProxy();
            this.sharedProxy.connect();
            // Listen to initial session_info for logging/diagnostics
            this.sharedProxy.on("session_info", (info) => {
                try {
                    console.info(
                        `[Panel] Session info: connected=${info.isConnected} epoch=${info.sessionEpochMs} idleFps=${info.idleCaptureFps} activeFps=${info.activeCaptureFps}`
                    );
                    // Phase 5: initialize owner state on first info
                    if (info.ownerPanelId) {
                        const amOwner =
                            info.ownerPanelId === this.sharedProxy.panelId;
                        this._applyOwnerState(amOwner);
                    }
                    // Apply initial mode to UI
                    this._applyModeState(!!info.globalActive);
                } catch (_) {}
            });
            // Phase 4/5/7: focus pings, heartbeat, owner change logging, mode sync
            try {
                const isActive = () =>
                    document.visibilityState === "visible" &&
                    document.hasFocus();
                const sendPing = () => {
                    try {
                        this.sharedProxy.sendFocusPing(isActive());
                    } catch (_) {}
                };
                // Initial ping after connect
                setTimeout(sendPing, 0);
                window.addEventListener("focus", sendPing);
                document.addEventListener("visibilitychange", sendPing);
                // Heartbeat: send only when active or when active state flips
                let lastActive = null;
                setInterval(() => {
                    const nowActive = isActive();
                    if (nowActive || nowActive !== lastActive) {
                        sendPing();
                    }
                    lastActive = nowActive;
                }, 1000);
                this.sharedProxy.on("owner_changed", ({ ownerPanelId }) => {
                    try {
                        console.info(
                            `[Panel] owner_changed owner=${ownerPanelId} thisPanel=${this.sharedProxy.panelId}`
                        );
                        const amOwner =
                            ownerPanelId === this.sharedProxy.panelId;
                        this._applyOwnerState(amOwner);
                    } catch (_) {}
                });
                this.sharedProxy.on("mode_changed", ({ active }) => {
                    try {
                        console.info(`[Panel] mode_changed active=${!!active}`);
                        this._applyModeState(!!active);
                    } catch (_) {}
                });
            } catch (_) {}
        } catch (_) {}

        this.serverClient = new ServerClient();
        this.videoHandler = new VideoHandler(
            this.serverClient,
            this.sharedProxy
        );
        this.audioHandler = new AudioHandler(
            this.sharedProxy ?? this.serverClient,
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
        // Wire mic button to toggle Active/Idle
        try {
            this.uiManager.elements.voiceButton.addEventListener(
                "click",
                () => {
                    try {
                        this.sharedProxy.requestActiveToggle();
                    } catch (_) {}
                }
            );
        } catch (_) {}
        this.initializeCallbacks();
        this.lifecycleManager.trackSidePanelLifecycle();
        this.lifecycleManager.checkAndClearChatHistoryOnReload();
        this.eventManager.initializeCrossWindowSync();
        this.lifecycleManager.restoreState();
    }

    _applyOwnerState(amOwner) {
        try {
            if (amOwner) {
                this.videoHandler.setOwner(true);
                // Respect current mode; VideoHandler.startScreenshotStreaming will pick FPS
                this.videoHandler.setMode(
                    this._currentActive ? "active" : "idle"
                );
                // Audio: owner-only capture and streaming
                this.audioHandler
                    .setupAudioCapture()
                    .then(() => {
                        this.audioHandler.startAudioStreaming();
                    })
                    .catch(() => {});
            } else {
                // Stop audio entirely when not owner
                this.audioHandler.stopAudioProcessing();
                this.videoHandler.setOwner(false);
            }
        } catch (_) {}
    }

    _applyModeState(active) {
        this._currentActive = !!active;
        try {
            this.videoHandler.setMode(this._currentActive ? "active" : "idle");
            // UI: reflect mode on mic button
            const btn = this.uiManager?.elements?.voiceButton;
            if (btn) {
                if (this._currentActive) btn.classList.add("listening");
                else btn.classList.remove("listening");
            }
            // Status text
            if (this._currentActive) {
                this.uiManager.uiState.showStatus("Active", "info");
            } else {
                this.uiManager.uiState.showStatus("Idle", "info");
            }
        } catch (_) {}
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

        // Frontend VAD: app-level hooks for orchestration
        this.multimediaOrchestrator.setSpeechActivityCallbacks({
            onStart: () => {
                try {
                    // Optional UI hint: mark speaking state while session active
                    if (
                        this.multimediaOrchestrator.isMultimediaSessionActive()
                    ) {
                        this.uiManager.uiState.setSpeechState?.("speaking");
                    }
                } catch (_) {}
            },
            onEnd: ({ segmentStartMs, segmentEndMs }) => {
                try {
                    // Optional UI hint: return to listening state if session still active
                    if (
                        this.multimediaOrchestrator.isMultimediaSessionActive()
                    ) {
                        this.uiManager.uiState.setSpeechState?.("listening");
                    }
                } catch (_) {}
            },
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
