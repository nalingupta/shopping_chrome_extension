import { ServerWsClient } from "./server-ws-client.js";
import { ContextAssembler } from "./prompt/context-assembler.js";

export class AIHandler {
    constructor() {
        this.serverAPI = new ServerWsClient();
        this.isGeminiConnected = false; // semantic name retained for minimal surface change
        this.currentPageInfo = null;
        this._lastUserMessage = null; // finalized user text or transcript

        this.setupGeminiCallbacks();
        this.initializeGemini();
    }

    async initializeGemini() {
        try {
            // No-op for server client
        } catch (error) {
            console.error("Error initializing Gemini:", error);
        }
    }

    setupGeminiCallbacks() {
        this.serverAPI.setBotResponseCallback((data) => {
            this.handleGeminiResponse(data);
        });

        this.serverAPI.setStatusCallback((update) => {
            this.handleStreamingUpdate(update);
        });

        this.serverAPI.setConnectionStateCallback((state) => {
            if (state === "connected") {
                this.isGeminiConnected = true;
            } else if (state === "disconnected") {
                this.isGeminiConnected = false;
            }
        });

        this.serverAPI.setErrorCallback((error) => {
            console.error("Gemini error:", error);
        });
    }

    // Gemini Methods
    async connectToGemini() {
        if (this.isGeminiConnected) {
            return { success: true };
        }

        try {
            const result = await this.serverAPI.connect({
                fps: 10,
                sampleRate: 16000,
            });
            if (!result.success) {
                throw new Error(result.error || "Failed to connect to Gemini");
            }
            this.isGeminiConnected = true;
            return { success: true };
        } catch (error) {
            console.error("Failed to connect to Gemini:", error);
            return { success: false, error: error.message };
        }
    }

    async disconnectFromGemini() {
        try {
            await this.serverAPI.disconnect();
            this.isGeminiConnected = false;
            return { success: true };
        } catch (error) {
            console.error("Failed to disconnect from Gemini:", error);
            return { success: false, error: error.message };
        }
    }

    isGeminiConnectionActive() {
        return (
            this.isGeminiConnected &&
            this.serverAPI.getConnectionStatus().isConnected
        );
    }

    // Phase 2: media streaming methods
    sendAudioPcm(base64Pcm, tsStartMs, numSamples, sampleRate = 16000) {
        if (!this.isGeminiConnectionActive()) return;
        this.serverAPI.sendAudioPcm(
            base64Pcm,
            tsStartMs,
            numSamples,
            sampleRate
        );
    }

    sendImageFrame(base64Jpeg, tsMs) {
        if (!this.isGeminiConnectionActive()) return;
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
        return this.isGeminiConnectionActive();
    }

    getSessionStartMs() {
        return this.serverAPI.sessionStartMs || null;
    }

    // Internal methods for handling Gemini responses
    handleGeminiResponse(data) {
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
