import { API_CONFIG } from "../config/api-keys.js";
import { streamingLogger } from "../utils/streaming-logger.js";

export class GeminiLiveAPI {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSetupComplete = false;
        this.audioContext = null;
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
        this.responseQueue = [];
        this.currentTurn = [];
        this.isProcessingTurn = false;
        this.currentStreamingResponse = ""; // Track streaming response
        this.isStreaming = false; // Track if we're currently streaming
        this.callbacks = {
            onBotResponse: null,
            onConnectionStateChange: null,
            onError: null,
            onStreamingUpdate: null, // Optional: for real-time streaming updates
        };
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.isManualStop = false;
    }

    async initialize() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext ||
                    window.webkitAudioContext)({
                    sampleRate: 16000,
                });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async connect() {
        if (this.isConnected) {
            return { success: true };
        }

        return new Promise((resolve, reject) => {
            try {
                this.isManualStop = false;
                this.isSetupComplete = false;
                this.pendingAudioChunks = [];
                this.pendingVideoFrames = [];

                const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_CONFIG.GEMINI_API_KEY}`;

                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = "blob";

                this.ws.onopen = async () => {
                    console.log("Gemini WebSocket connected successfully");
                    this.isConnected = true;
                    this.reconnectAttempts = 0;

                    await new Promise((resolve) => setTimeout(resolve, 100));
                    console.log("Sending Gemini configuration...");
                    this.sendConfiguration();
                    this.startKeepAlive();

                    // Start streaming logger
                    streamingLogger.start();

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("connected");
                    }
                    resolve({ success: true });
                };

                this.ws.onmessage = async (event) => {
                    let data;
                    if (event.data instanceof Blob) {
                        data = await event.data.text();
                    } else {
                        data = event.data;
                    }
                    this.handleMessage(data);
                };

                this.ws.onerror = (error) => {
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                    reject(new Error("WebSocket connection failed"));
                };

                this.ws.onclose = (event) => {
                    this.isConnected = false;
                    this.isSetupComplete = false;
                    this.stopKeepAlive();
                    this.clearBuffers();

                    // Stop streaming logger
                    streamingLogger.stop();

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("disconnected");
                    }

                    if (
                        !this.isManualStop &&
                        this.reconnectAttempts < this.maxReconnectAttempts
                    ) {
                        this.scheduleReconnection();
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    sendConfiguration() {
        const setupMessage = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                systemInstruction: {
                    parts: [
                        {
                            text: `You are a helpful shopping assistant with access to both visual and audio input from the user.

You receive periodic screen captures and can hear their questions through their microphone. The visual data may not always be perfectly clear or up-to-date.

Your capabilities:
- Analyze product listings, prices, and reviews when visible on screen
- Compare products across different sites as the user browses
- Provide shopping recommendations based on what you can see
- Answer questions about products visible in the screen captures
- Help with price comparisons and deal analysis
- Identify product features from images/videos on the page

When responding:
1. Only comment on what you can clearly see in the screen captures
2. If the visual information is unclear, ask for clarification
3. Base recommendations on what is actually visible, not assumptions
4. Be conversational and natural in your responses
5. If you can't see specific shopping content clearly, ask them to navigate to or describe the product

Important: Only describe what you can actually see in the provided screen captures. If something is unclear or not visible, say so rather than making assumptions.`,
                        },
                    ],
                },
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                    candidateCount: 1,
                    responseModalities: ["TEXT"],
                },
            },
        };

        this.sendMessage(setupMessage);
    }

    sendAudioChunk(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            this.pendingAudioChunks.push(base64Data);
            return;
        }

        // Log audio chunk for streaming statistics
        streamingLogger.logAudioChunk(base64Data.length);

        const message = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: "audio/pcm;rate=16000",
                },
            },
        };
        this.sendMessage(message);
    }

    sendVideoFrame(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            this.pendingVideoFrames.push(base64Data);
            return;
        }

        // Log video frame for streaming statistics
        streamingLogger.logVideoFrame(base64Data.length);

        const message = {
            realtimeInput: {
                mediaChunks: [
                    {
                        mimeType: "image/jpeg",
                        data: base64Data,
                    },
                ],
            },
        };
        this.sendMessage(message);
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);

                // Debug: Log all messages being sent to Gemini
                if (
                    message.realtimeInput?.audio ||
                    message.realtimeInput?.mediaChunks
                ) {
                    console.log("📤 Sending to Gemini:", {
                        type: message.realtimeInput?.audio ? "audio" : "video",
                        dataLength:
                            message.realtimeInput?.audio?.data?.length ||
                            message.realtimeInput?.mediaChunks?.[0]?.data
                                ?.length ||
                            0,
                    });
                } else {
                    console.log(
                        "📤 Sending to Gemini:",
                        messageStr.substring(0, 200) +
                            (messageStr.length > 200 ? "..." : "")
                    );
                }

                this.ws.send(messageStr);
            } catch (error) {
                console.error("Failed to send message:", error);
            }
        } else {
            console.warn(
                "Cannot send message - WebSocket not ready. State:",
                this.ws?.readyState
            );
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);

            // Temporary debug: Log all incoming messages
            console.log(
                "📨 Gemini message received:",
                JSON.stringify(message, null, 2)
            );

            if (
                message.setupComplete !== undefined ||
                message.setup_complete !== undefined
            ) {
                console.log("Gemini setup complete");
                this.isSetupComplete = true;
                this.processBufferedChunks();
                return;
            }

            // Only log important messages to reduce console noise
            if (message.serverContent?.turnComplete === true) {
                console.log("Turn complete flag found");
            }

            this.responseQueue.push(message);
            this.processResponseQueue();
        } catch (error) {
            console.error("Error parsing Gemini message:", error);
        }
    }

    async processResponseQueue() {
        if (this.isProcessingTurn) {
            return;
        }

        while (this.responseQueue.length > 0) {
            const message = this.responseQueue.shift();
            this.currentTurn.push(message);

            // Extract text from this message chunk
            const chunkText = this.extractTextFromMessage(message);
            if (chunkText) {
                this.currentStreamingResponse += chunkText;
                this.isStreaming = true;

                // Send real-time streaming update to UI (ChatGPT-style)
                if (this.callbacks.onStreamingUpdate) {
                    this.callbacks.onStreamingUpdate({
                        text: this.currentStreamingResponse,
                        isComplete: false,
                        timestamp: Date.now(),
                    });
                }
            }

            // Only rely on explicit turn completion flag from Gemini
            const isTurnComplete =
                message.serverContent?.turnComplete === true ||
                message.serverContent?.turn_complete === true ||
                message.turnComplete === true ||
                message.turn_complete === true;

            if (isTurnComplete) {
                console.log(
                    "Turn complete detected, processing final response"
                );
                this.isProcessingTurn = true;
                await this.handleCompleteTurn(this.currentStreamingResponse);
                this.currentTurn = [];
                this.currentStreamingResponse = "";
                this.isStreaming = false;
                this.isProcessingTurn = false;
                break;
            }
        }
    }

    extractTextFromMessage(message) {
        let text = "";

        // Check for different possible response structures
        if (
            message.serverContent &&
            message.serverContent.modelTurn &&
            message.serverContent.modelTurn.parts
        ) {
            message.serverContent.modelTurn.parts.forEach((part) => {
                if (part.text) {
                    text += part.text;
                }
            });
        }

        // Check for direct text in serverContent
        if (message.serverContent && message.serverContent.text) {
            text += message.serverContent.text;
        }

        // Check for direct text in message
        if (message.text) {
            text += message.text;
        }

        // Check for parts array in serverContent
        if (message.serverContent && message.serverContent.parts) {
            message.serverContent.parts.forEach((part) => {
                if (part.text) {
                    text += part.text;
                }
            });
        }

        return text;
    }

    async handleCompleteTurn(finalText) {
        if (finalText && this.callbacks.onBotResponse) {
            this.callbacks.onBotResponse({
                text: finalText,
                isStreaming: false, // Explicitly mark as final response
                timestamp: Date.now(),
            });
        }
    }

    processBufferedChunks() {
        const audioChunks = [...this.pendingAudioChunks];
        this.pendingAudioChunks = [];
        audioChunks.forEach((base64Data) => {
            this.sendAudioChunk(base64Data);
        });

        const videoFrames = [...this.pendingVideoFrames];
        this.pendingVideoFrames = [];
        videoFrames.forEach((base64Data) => {
            this.sendVideoFrame(base64Data);
        });
    }

    startKeepAlive() {
        this.stopKeepAlive();

        this.keepAliveTimer = setInterval(() => {
            if (
                this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                !this.isManualStop
            ) {
                const keepAliveMessage = {
                    realtimeInput: {
                        mediaChunks: [],
                    },
                };

                try {
                    this.ws.send(JSON.stringify(keepAliveMessage));
                } catch (error) {
                    console.error("Keep-alive failed:", error);
                }
            }
        }, 30000);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    scheduleReconnection() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        const delay = Math.min(
            Math.pow(2, this.reconnectAttempts) * 1000,
            30000
        );
        this.reconnectAttempts++;

        this.reconnectTimer = setTimeout(async () => {
            if (!this.isManualStop) {
                try {
                    await this.connect();
                } catch (error) {
                    console.error("Reconnection failed:", error);
                }
            }
        }, delay);
    }

    clearBuffers() {
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
        this.responseQueue = [];
        this.currentTurn = [];
        this.isProcessingTurn = false;
        this.currentStreamingResponse = "";
        this.isStreaming = false;
    }

    async disconnect() {
        this.isManualStop = true;

        this.stopKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.audioContext && this.audioContext.state === "running") {
            await this.audioContext.suspend();
        }

        this.isConnected = false;
        this.isSetupComplete = false;
        this.clearBuffers();

        // Stop streaming logger
        streamingLogger.stop();
    }

    setBotResponseCallback(callback) {
        this.callbacks.onBotResponse = callback;
    }

    setConnectionStateCallback(callback) {
        this.callbacks.onConnectionStateChange = callback;
    }

    setErrorCallback(callback) {
        this.callbacks.onError = callback;
    }

    setStreamingUpdateCallback(callback) {
        this.callbacks.onStreamingUpdate = callback;
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isSetupComplete: this.isSetupComplete,
        };
    }
}
