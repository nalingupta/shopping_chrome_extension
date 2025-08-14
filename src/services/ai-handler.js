import { ServerWsClient } from "./server-ws-client.js";
import { ContextAssembler } from "./prompt/context-assembler.js";
import { DEFAULT_CAPTURE_FPS } from "../config/features.js";

export class AIHandler {
    constructor() {
        this.serverAPI = new ServerWsClient();
        this._isConnected = false;
        this.currentPageInfo = null;
        this._lastUserMessage = null; // finalized user text or transcript

        this.setupCallbacks();
        this.initialize();
    }

    async initialize() {
        try {
            // No-op for server client
        } catch (error) {
            console.error("Error initializing AI handler:", error);
        }
    }

    setupCallbacks() {
        this.serverAPI.setBotResponseCallback((data) => {
            this.handleResponse(data);
        });

        this.serverAPI.setStatusCallback((update) => {
            this.handleStreamingUpdate(update);
        });

        this.serverAPI.setConnectionStateCallback((state) => {
            if (state === "connected") {
                this._isConnected = true;
            } else if (state === "disconnected") {
                this._isConnected = false;
            }
        });

        this.serverAPI.setErrorCallback((error) => {
            console.error("AI error:", error);
        });
    }

    // Connection Methods
    async connect(opts = {}) {
        if (this._isConnected) {
            return { success: true };
        }

        try {
            const result = await this.serverAPI.connect({
                fps: DEFAULT_CAPTURE_FPS,
                sampleRate:
                    typeof opts.sampleRate === "number" && opts.sampleRate > 0
                        ? opts.sampleRate
                        : 16000,
            });
            if (!result.success) {
                throw new Error(
                    result.error || "Failed to connect to AI server"
                );
            }
            this._isConnected = true;
            return { success: true };
        } catch (error) {
            console.error("Failed to connect to AI server:", error);
            return { success: false, error: error.message };
        }
    }

    async disconnect() {
        try {
            await this.serverAPI.disconnect();
            this._isConnected = false;
            return { success: true };
        } catch (error) {
            console.error("Failed to disconnect from AI server:", error);
            return { success: false, error: error.message };
        }
    }

    isConnectionActive() {
        return (
            this._isConnected &&
            this.serverAPI.getConnectionStatus().isConnected
        );
    }

    // Phase 2: media streaming methods
    sendAudioPcm(base64Pcm, tsStartMs, numSamples, sampleRate = 16000) {
        if (!this.isConnectionActive()) return;
        this.serverAPI.sendAudioPcm(
            base64Pcm,
            tsStartMs,
            numSamples,
            sampleRate
        );
    }

    sendImageFrame(base64Jpeg, tsMs) {
        if (!this.isConnectionActive()) return;
        this.serverAPI.sendImageFrame(base64Jpeg, tsMs);
    }

    // Utterance boundary helpers
    startUtterance() {
        try {
            this._utteranceStartTs = Date.now();
            // No-op for server-mediated flow
        } catch (_) {}
    }

    endUtterance() {
        (async () => {
            try {
                // No-op for server-mediated flow
            } catch (_) {}
            try {
                // No-op for server-mediated flow
                const elapsed = this._utteranceStartTs
                    ? Date.now() - this._utteranceStartTs
                    : 0;
                void elapsed;
            } catch (_) {}
            try {
                // No-op for server-mediated flow
            } catch (_) {}
        })();
    }

    setCurrentPageInfo(pageInfo) {
        this.currentPageInfo = pageInfo || null;
    }

    setLastUserMessage(text) {
        this._lastUserMessage = typeof text === "string" ? text : null;
    }

    // REST API Methods (for text messages)
    async sendTextMessage(message) {
        // Phase 1: route text over WS to backend; backend may echo/ack only in this phase
        try {
            this.serverAPI.sendTextMessage(String(message || ""));
            return { success: true };
        } catch (error) {
            console.error("Failed to send text over WS:", error);
            return { success: false, error: error.message };
        }
    }

    async getTextResponse() {
        // This would be implemented to get text responses from REST API
        // For now, this is handled through the Gemini callbacks
        return { success: true };
    }

    // Common Methods
    isConnected() {
        return this.isConnectionActive();
    }

    getSessionStartMs() {
        return this.serverAPI.sessionStartMs || null;
    }

    // Internal methods for handling responses
    handleResponse(data) {
        if (data.text) {
            // This will be handled by the callback system
            // The response will be passed to the appropriate handler
        }
    }

    handleStreamingUpdate(update) {
        if (update.text) {
            // This will be handled by the callback system
            // The streaming update will be passed to the appropriate handler
        }
    }

    // Callback setters for coordination with other handlers
    setBotResponseCallback(callback) {
        this.serverAPI.setBotResponseCallback(callback);
    }

    setStreamingUpdateCallback(callback) {
        this.serverAPI.setStatusCallback(callback);
    }

    setConnectionStateCallback(callback) {
        this.serverAPI.setConnectionStateCallback(callback);
    }

    setErrorCallback(callback) {
        this.serverAPI.setErrorCallback(callback);
    }
}
