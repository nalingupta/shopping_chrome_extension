import { WebSocketManager } from "../services/websocket-manager.js";
import { API_CONFIG } from "../config/api-keys.js";
import { MESSAGE_TYPES } from "../utils/constants.js";

class OffscreenWebSocketManager {
    constructor() {
        this.webSocketManager = new WebSocketManager();
        this.isInitialized = false;
        this.statusElement = document.getElementById("status");

        this.initialize();
    }

    async initialize() {
        try {
            this.updateStatus("Initializing WebSocket manager...");

            // Set up WebSocket callbacks
            this.webSocketManager.setMessageCallback((response) => {
                console.log("📨 Offscreen: Received WebSocket response");
                this.forwardToBackground(
                    MESSAGE_TYPES.WEBSOCKET_RESPONSE,
                    response
                );
            });

            this.webSocketManager.setConnectionStateCallback((state) => {
                console.log(
                    `🔌 Offscreen: WebSocket state changed to ${state}`
                );
                this.forwardToBackground(MESSAGE_TYPES.WEBSOCKET_STATE_CHANGE, {
                    state,
                });
                this.updateStatus(`WebSocket: ${state}`);
            });

            this.webSocketManager.setErrorCallback((error) => {
                console.error("❌ Offscreen: WebSocket error:", error);
                this.forwardToBackground(MESSAGE_TYPES.WEBSOCKET_ERROR, {
                    error: error.message,
                });
                this.updateStatus(`WebSocket Error: ${error.message}`);
            });

            // Initialize WebSocket connection
            await this.webSocketManager.initialize();
            this.isInitialized = true;
            this.updateStatus("WebSocket ready");

            console.log("✅ Offscreen: WebSocket manager initialized");
        } catch (error) {
            console.error(
                "❌ Offscreen: Failed to initialize WebSocket manager:",
                error
            );
            this.updateStatus(`Initialization failed: ${error.message}`);
        }
    }

    updateStatus(message) {
        if (this.statusElement) {
            this.statusElement.textContent = message;
        }
        console.log(`📊 Offscreen Status: ${message}`);
    }

    forwardToBackground(type, data) {
        chrome.runtime
            .sendMessage({
                type: type,
                data: data,
                source: "offscreen",
            })
            .catch((error) => {
                console.warn(
                    "⚠️ Offscreen: Failed to forward message to background:",
                    error
                );
            });
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.type) {
                case MESSAGE_TYPES.SEND_TEXT_MESSAGE:
                    if (!this.isInitialized) {
                        throw new Error("WebSocket manager not initialized");
                    }

                    const { text, screenshotDataUrl } = request.data;
                    console.log("💬 Offscreen: Processing text message");

                    const response =
                        await this.webSocketManager.sendTextMessage(
                            text,
                            screenshotDataUrl
                        );
                    sendResponse({ success: true, response });
                    break;

                case MESSAGE_TYPES.GET_WEBSOCKET_STATUS:
                    const status = this.webSocketManager.getConnectionStatus();
                    sendResponse({ success: true, status });
                    break;

                case MESSAGE_TYPES.SEND_AUDIO_CHUNK:
                    if (!this.isInitialized) {
                        throw new Error('WebSocket manager not initialized');
                    }
                    
                    const { audioData } = request.data;
                    console.log('🎤 Offscreen: Sending audio chunk');
                    
                    // Send audio data through WebSocket
                    this.webSocketManager.sendAudioChunk(audioData);
                    sendResponse({ success: true });
                    break;
                    
                case MESSAGE_TYPES.SEND_VIDEO_FRAME:
                    if (!this.isInitialized) {
                        throw new Error('WebSocket manager not initialized');
                    }
                    
                    const { videoData } = request.data;
                    console.log('📹 Offscreen: Sending video frame');
                    
                    // Send video data through WebSocket
                    this.webSocketManager.sendVideoFrame(videoData);
                    sendResponse({ success: true });
                    break;
                    
                case MESSAGE_TYPES.RECONNECT_WEBSOCKET:
                    console.log("🔄 Offscreen: Reconnecting WebSocket");
                    await this.webSocketManager.disconnect();
                    await this.webSocketManager.initialize();
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({
                        success: false,
                        error: "Unknown message type",
                    });
            }
        } catch (error) {
            console.error("❌ Offscreen: Error handling message:", error);
            sendResponse({ success: false, error: error.message });
        }
    }
}

// Initialize the offscreen WebSocket manager
const offscreenManager = new OffscreenWebSocketManager();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    offscreenManager.handleMessage(request, sender, sendResponse);
    return true; // Keep message channel open for async response
});

// Handle offscreen document lifecycle
document.addEventListener("DOMContentLoaded", () => {
    console.log("📄 Offscreen: Document loaded");
});

window.addEventListener("beforeunload", () => {
    console.log("📄 Offscreen: Document unloading");
    // Clean up WebSocket connection
    if (offscreenManager.webSocketManager) {
        offscreenManager.webSocketManager.disconnect();
    }
});
