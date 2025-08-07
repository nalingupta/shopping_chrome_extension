import { GeminiLiveAPI } from "./gemini-api.js";

export class AIHandler {
    constructor() {
        this.geminiAPI = new GeminiLiveAPI();
        this.isGeminiConnected = false;

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

    // REST API Methods (for text messages)
    async sendTextMessage(message) {
        // This would be implemented to send text messages via REST API
        // For now, we'll use Gemini as a fallback
        try {
            if (this.isGeminiConnectionActive()) {
                this.geminiAPI.sendMessage(message);
                return { success: true };
            } else {
                // If Gemini is not connected, try to connect first
                const connectResult = await this.connectToGemini();
                if (connectResult.success) {
                    this.geminiAPI.sendMessage(message);
                    return { success: true };
                } else {
                    throw new Error("Failed to connect to AI service");
                }
            }
        } catch (error) {
            console.error("Failed to send text message:", error);
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
