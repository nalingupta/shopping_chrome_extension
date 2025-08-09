import { GeminiRealtimeClient } from "./gemini-realtime-client.js";
import { GeminiTextClient } from "./gemini-text-client.js";
import { ContextAssembler } from "./prompt/context-assembler.js";
import { API_CONFIG } from "../config/api-keys.js";
import { ADKClient } from "./adk-client.js";

export class AIHandler {
    constructor() {
        this.geminiAPI = new GeminiRealtimeClient();
        this.isGeminiConnected = false;
        this.currentPageInfo = null;
        this._lastUserMessage = null; // finalized user text or transcript
        this._utteranceStartTs = null;

        // ADK mode toggle (independent functionality)
        this.isAdkMode = !!API_CONFIG?.ADK_MODE_ENABLED;
        this.adkClient = this.isAdkMode ? new ADKClient() : null;
        this.isAdkConnected = false;

        // UI callback references (used by both Gemini and ADK paths)
        this._onBotResponse = null;
        this._onStreamingUpdate = null;
        this._onConnectionStateChange = null;
        this._onError = null;

        this.setupGeminiCallbacks();
        if (this.isAdkMode) {
            this.setupAdkCallbacks();
        }
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

    setupAdkCallbacks() {
        if (!this.adkClient) return;
        this._adkStreamingBuffer = "";
        this.adkClient.setHandlers({
            onOpen: () => {
                this.isAdkConnected = true;
                if (this._onConnectionStateChange)
                    this._onConnectionStateChange("connected");
            },
            onClose: () => {
                this.isAdkConnected = false;
                if (this._onConnectionStateChange)
                    this._onConnectionStateChange("disconnected");
            },
            onTextDelta: (msg) => {
                const delta = typeof msg?.text === "string" ? msg.text : "";
                if (!delta) return;
                this._adkStreamingBuffer += delta;
                if (this._onStreamingUpdate) {
                    this._onStreamingUpdate({
                        text: this._adkStreamingBuffer,
                        isStreaming: true,
                        isComplete: false,
                        timestamp: Date.now(),
                    });
                }
            },
            onTurnComplete: () => {
                const finalText = this._adkStreamingBuffer || "";
                if (finalText && this._onBotResponse) {
                    this._onBotResponse({
                        text: finalText,
                        isStreaming: false,
                        timestamp: Date.now(),
                    });
                }
                this._adkStreamingBuffer = "";
            },
            onError: (err) => {
                if (this._onError) this._onError(err);
            },
        });
    }

    // Gemini Methods
    async connectToGemini() {
        // Maintain existing method name for orchestrator compatibility
        if (this.isAdkMode) {
            if (this.isAdkConnected) return { success: true };
            try {
                const url = API_CONFIG?.ADK_WS_URL;
                const token = API_CONFIG?.ADK_TOKEN || "";
                const res = await this.adkClient.connect(url, token);
                if (!res?.success) throw new Error("ADK connect failed");
                const model = API_CONFIG?.ADK_MODEL || "gemini-1.5-pro";
                this.adkClient.sendSessionStart(model, {
                    response_modalities: ["TEXT"],
                });
                this.isAdkConnected = true;
                return { success: true };
            } catch (error) {
                console.error("Failed to connect to ADK WS:", error);
                return { success: false, error: error.message };
            }
        }

        // Default: Gemini
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
            if (this.isAdkMode && this.adkClient) {
                this.adkClient.close();
                this.isAdkConnected = false;
                return { success: true };
            }
            await this.geminiAPI.disconnect();
            this.isGeminiConnected = false;
            return { success: true };
        } catch (error) {
            console.error("Failed to disconnect:", error);
            return { success: false, error: error.message };
        }
    }

    isGeminiConnectionActive() {
        if (this.isAdkMode) {
            return !!(this.isAdkConnected && this.adkClient);
        }
        return (
            this.isGeminiConnected &&
            this.geminiAPI.getConnectionStatus().isConnected
        );
    }

    sendAudioData(audioData) {
        if (this.isAdkMode) {
            // Phase: text-only ADK wiring; audio not streamed here
            return;
        }
        if (this.isGeminiConnectionActive()) {
            this.geminiAPI.sendAudioChunk(audioData);
        }
    }

    sendVideoData(videoData) {
        if (this.isAdkMode) {
            // Phase: text-only ADK wiring; video not streamed here
            return;
        }
        if (this.isGeminiConnectionActive()) {
            this.geminiAPI.sendVideoFrame(videoData);
        }
    }

    // ADK helper for video chunk forwarding (used by VideoHandler)
    sendAdkVideoChunk(blob, header) {
        if (!this.isAdkMode || !this.adkClient || !this.isAdkConnected) return;
        try {
            this.adkClient.sendVideoChunk(blob, header || {});
        } catch (_) {}
    }

    // Utterance boundary helpers
    startUtterance() {
        try {
            this._utteranceStartTs = Date.now();
            if (this.isAdkMode) {
                this.adkClient?.sendActivityStart();
                return;
            }
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
                if (this.isAdkMode) {
                    const text = (this._lastUserMessage || "").trim();
                    if (text) this.adkClient?.sendTextInput(text);
                    this.adkClient?.sendActivityEnd();
                    return;
                }
                // Send only the finalized user message as a clientContent user turn
                if (this._lastUserMessage && this._lastUserMessage.trim()) {
                    const text = this._lastUserMessage.trim();
                    this.geminiAPI.sendUserMessage(text);
                }
            } catch (_) {}
            try {
                if (!this.isAdkMode) {
                    this.geminiAPI.sendActivityEnd();
                    const elapsed = this._utteranceStartTs
                        ? Date.now() - this._utteranceStartTs
                        : 0;
                    this.geminiAPI.logUtteranceEnd?.(elapsed);
                }
            } catch (_) {}
            try {
                if (!this.isAdkMode) this.geminiAPI.disableAudioInput();
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
        if (this.isAdkMode) {
            try {
                const text = (message || "").toString();
                if (text.trim()) {
                    this.adkClient?.sendTextInput(text.trim());
                }
                return { success: true };
            } catch (error) {
                console.error("Failed to send text message via ADK WS:", error);
                return { success: false, error: error.message };
            }
        }
        // Use REST API flow for text input
        try {
            console.debug("[AIHandler] sendTextMessage start");
            // Use the unified generator which assembles history + page context
            const responseText = await GeminiTextClient.generateGeminiResponse(
                message,
                this.currentPageInfo
            );

            // Forward as if it were a final bot response
            if (
                responseText &&
                (this._onBotResponse ||
                    (this.geminiAPI && this.geminiAPI.callbacks))
            ) {
                const onBotResponse =
                    this._onBotResponse ||
                    this.geminiAPI.callbacks.onBotResponse;
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
        this._onBotResponse = callback;
        this.geminiAPI.setBotResponseCallback(callback);
    }

    setStreamingUpdateCallback(callback) {
        this._onStreamingUpdate = callback;
        this.geminiAPI.setStreamingUpdateCallback(callback);
    }

    setConnectionStateCallback(callback) {
        this._onConnectionStateChange = callback;
        this.geminiAPI.setConnectionStateCallback(callback);
    }

    setErrorCallback(callback) {
        this._onError = callback;
        this.geminiAPI.setErrorCallback(callback);
    }
}
