import { GeminiRealtimeClient } from "./gemini-realtime-client.js";
import { GeminiTextClient } from "./gemini-text-client.js";
import { ContextAssembler } from "./prompt/context-assembler.js";

export class AIHandler {
    constructor() {
        this.geminiAPI = new GeminiRealtimeClient();
        this.isGeminiConnected = false;
        this.currentPageInfo = null;
        this._lastUserMessage = null; // finalized user text or transcript

        this.setupGeminiCallbacks();
        this.initializeGemini();
    }

    async initializeGemini() {
        try {
            const result = await this.geminiAPI.initialize();
            if (!result.success) {
                console.error("Gemini initialization failed:", result.error);
            }
        } catch (error) {
            console.error("Error initializing Gemini:", error);
        }
    }

    setupGeminiCallbacks() {
        this.geminiAPI.setBotResponseCallback((data) => {
            this.handleGeminiResponse(data);
        });

        this.geminiAPI.setStreamingUpdateCallback((update) => {
            this.handleStreamingUpdate(update);
        });

        this.geminiAPI.setConnectionStateCallback((state) => {
            if (state === "connected") {
                this.isGeminiConnected = true;
            } else if (state === "disconnected") {
                this.isGeminiConnected = false;
            }
        });

        this.geminiAPI.setErrorCallback((error) => {
            console.error("Gemini error:", error);
        });
    }

    // Gemini Methods
    async connectToGemini() {
        if (this.isGeminiConnected) {
            return { success: true };
        }

        try {
            const result = await this.geminiAPI.connect();
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
            await this.geminiAPI.disconnect();
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
            this.geminiAPI.getConnectionStatus().isConnected
        );
    }

    sendAudioData(audioData) {
        if (this.isGeminiConnectionActive()) {
            this.geminiAPI.sendAudioChunk(audioData);
        }
    }

    sendVideoData(videoData) {
        if (this.isGeminiConnectionActive()) {
            this.geminiAPI.sendVideoFrame(videoData);
        }
    }

    // Utterance boundary helpers
    startUtterance() {
        try {
            this._utteranceStartTs = Date.now();
            this.geminiAPI.enableAudioInput();
            try {
                this.geminiAPI.markUtteranceStart();
            } catch (_) {}
            this.geminiAPI.sendActivityStart();
        } catch (_) {}
    }

    endUtterance() {
        (async () => {
            try {
                // Send only the finalized user message as a clientContent user turn
                if (this._lastUserMessage && this._lastUserMessage.trim()) {
                    const text = this._lastUserMessage.trim();
                    this.geminiAPI.sendUserMessage(text);
                } else {
                    // No finalized user message to send
                }
            } catch (_) {}
            try {
                this.geminiAPI.sendActivityEnd();
                const elapsed = this._utteranceStartTs
                    ? Date.now() - this._utteranceStartTs
                    : 0;
                this.geminiAPI.logUtteranceEnd?.(elapsed);
            } catch (_) {}
            try {
                this.geminiAPI.disableAudioInput();
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
        // Use REST API flow for text input
        try {
            console.debug("[AIHandler] sendTextMessage start");
            // Use the unified generator which assembles history + page context
            const responseText = await GeminiTextClient.generateGeminiResponse(
                message,
                this.currentPageInfo
            );

            // Forward as if it were a final bot response
            if (responseText && this.geminiAPI && this.geminiAPI.callbacks) {
                const onBotResponse = this.geminiAPI.callbacks.onBotResponse;
                if (onBotResponse) {
                    console.debug(
                        `[AIHandler] sendTextMessage success, textLen=${
                            responseText?.length || 0
                        }`
                    );
                    onBotResponse({
                        text: responseText,
                        isStreaming: false,
                        timestamp: Date.now(),
                    });
                }
            }

            return { success: true };
        } catch (error) {
            console.error("Failed to send text message via REST:", error);
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
        this.geminiAPI.setBotResponseCallback(callback);
    }

    setStreamingUpdateCallback(callback) {
        this.geminiAPI.setStreamingUpdateCallback(callback);
    }

    setConnectionStateCallback(callback) {
        this.geminiAPI.setConnectionStateCallback(callback);
    }

    setErrorCallback(callback) {
        this.geminiAPI.setErrorCallback(callback);
    }
}
