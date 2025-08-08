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
        this.activeUtterance = false; // True after activityStart is sent
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
        this.audioInputEnabled = false;
        this.pendingTurnResolvers = [];
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

                    // Ensure AudioContext is running after previous suspend on disconnect
                    try {
                        if (
                            this.audioContext &&
                            this.audioContext.state === "suspended"
                        ) {
                            await this.audioContext.resume();
                        }
                    } catch (resumeError) {
                        console.warn(
                            "AudioContext resume failed:",
                            resumeError
                        );
                    }

                    await new Promise((resolve) => setTimeout(resolve, 100));
                    this.sendConfiguration();
                    this.startKeepAlive();

                    // Start streaming logger
                    streamingLogger.start();
                    console.log("[Gemini] setup requested");

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
                    this.activeUtterance = false;
                    this.stopKeepAlive();
                    this.clearBuffers();

                    // Stop streaming logger
                    streamingLogger.stop();

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("disconnected");
                    }

                    // Resolve any pending turn waiters on close
                    try {
                        const resolvers = this.pendingTurnResolvers.splice(0);
                        resolvers.forEach((resolve) => resolve(null));
                    } catch (_) {}

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
                // Disable server-side automatic VAD; we will send explicit activityStart/activityEnd
                realtimeInputConfig: {
                    automaticActivityDetection: {
                        disabled: true,
                    },
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

        // Send audio using mediaChunks per Gemini Live WS schema
        const message = {
            realtimeInput: {
                mediaChunks: [
                    {
                        data: base64Data,
                        mimeType: "audio/pcm;rate=16000",
                    },
                ],
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
            // Drop frame when not ready; do not buffer to avoid stale sends
            streamingLogger.logInfo("DROP video frame (setup not ready)");
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

    // Explicit utterance boundary controls
    sendActivityStart() {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            try {
                console.warn("[Gemini] skip activityStart", {
                    setupComplete: this.isSetupComplete,
                    hasWs: !!this.ws,
                    readyState: this.ws ? this.ws.readyState : -1,
                });
            } catch (_) {}
            return;
        }
        const message = { realtimeInput: { activityStart: {} } };
        try {
            this.ws.send(JSON.stringify(message));
            streamingLogger.logInfo("↗️ Sent activityStart");
            console.log("[Gemini] activityStart sent");
            this.activeUtterance = true;
        } catch (error) {
            console.error("Failed to send activityStart:", error);
        }
    }

    sendActivityEnd() {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        const message = { realtimeInput: { activityEnd: {} } };
        try {
            this.ws.send(JSON.stringify(message));
            streamingLogger.logInfo("↗️ Sent activityEnd");
            console.log("[Gemini] activityEnd sent");
            this.activeUtterance = false;
        } catch (error) {
            console.error("Failed to send activityEnd:", error);
        }
    }

    // Audio input gating
    enableAudioInput() {
        this.audioInputEnabled = true;
        streamingLogger.logInfo("🎤 Audio input ENABLED");
    }

    disableAudioInput() {
        this.audioInputEnabled = false;
        streamingLogger.logInfo("🎤 Audio input DISABLED");
    }

    isAudioInputEnabled() {
        return this.audioInputEnabled === true;
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);

                // Send message to Gemini

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

            // Minimal receive-side tracing to diagnose missing text
            try {
                const hasServerContent = !!message.serverContent;
                const hasModelTurn = !!message.serverContent?.modelTurn;
                const hasCandidates =
                    Array.isArray(message.candidates) ||
                    Array.isArray(message.serverContent?.candidates);
                const hasRealtimeOutput = !!message.realtimeOutput;
                const hasOutput = Array.isArray(message.output);

                const hasText = !!(
                    message.text ||
                    message.delta?.text ||
                    message.serverContent?.text ||
                    (Array.isArray(message.serverContent?.parts) &&
                        message.serverContent.parts.some((p) => p.text)) ||
                    (Array.isArray(message.serverContent?.modelTurn?.parts) &&
                        message.serverContent.modelTurn.parts.some(
                            (p) => p.text
                        )) ||
                    (Array.isArray(message.candidates) &&
                        message.candidates.some(
                            (c) =>
                                Array.isArray(c?.content?.parts) &&
                                c.content.parts.some((p) => p.text)
                        )) ||
                    (Array.isArray(message.serverContent?.candidates) &&
                        message.serverContent.candidates.some(
                            (c) =>
                                Array.isArray(c?.content?.parts) &&
                                c.content.parts.some((p) => p.text)
                        )) ||
                    (Array.isArray(message.realtimeOutput?.output) &&
                        message.realtimeOutput.output.some(
                            (o) =>
                                Array.isArray(o?.content?.parts) &&
                                o.content.parts.some((p) => p.text)
                        )) ||
                    (Array.isArray(message.output) &&
                        message.output.some(
                            (o) =>
                                Array.isArray(o?.content?.parts) &&
                                o.content.parts.some((p) => p.text)
                        ))
                );
                console.log("[Gemini] rx", {
                    keys: Object.keys(message).slice(0, 5),
                    hasText,
                    hasServerContent,
                    hasModelTurn,
                    hasCandidates,
                    hasRealtimeOutput,
                    hasOutput,
                });
            } catch (_) {}

            if (
                message.setupComplete !== undefined ||
                message.setup_complete !== undefined
            ) {
                this.isSetupComplete = true;
                console.log("[Gemini] setupComplete");
                this.processBufferedChunks();
                return;
            }

            // Check for turn completion flag

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
                try {
                    console.log("[Gemini] text-chunk", chunkText.slice(0, 40));
                } catch (_) {}

                // Send real-time streaming update to UI (ChatGPT-style)
                if (this.callbacks.onStreamingUpdate) {
                    this.callbacks.onStreamingUpdate({
                        text: this.currentStreamingResponse,
                        isStreaming: true,
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
                this.isProcessingTurn = true;
                await this.handleCompleteTurn(this.currentStreamingResponse);
                this.currentTurn = [];
                this.currentStreamingResponse = "";
                this.isStreaming = false;
                this.isProcessingTurn = false;
                console.log("[Gemini] turnComplete");
                break;
            }
        }
    }

    extractTextFromMessage(message) {
        let text = "";

        // Known shapes from Gemini Live API
        // 1) serverContent.modelTurn.parts[].text
        const modelTurnParts = message.serverContent?.modelTurn?.parts;
        if (Array.isArray(modelTurnParts)) {
            modelTurnParts.forEach((part) => {
                if (part?.text) text += part.text;
            });
        }

        // 2) serverContent.parts[].text
        const serverParts = message.serverContent?.parts;
        if (Array.isArray(serverParts)) {
            serverParts.forEach((part) => {
                if (part?.text) text += part.text;
            });
        }

        // 3) serverContent.text
        if (message.serverContent?.text) {
            text += message.serverContent.text;
        }

        // 4) top-level text and delta.text (incremental)
        if (message.text) {
            text += message.text;
        }
        if (message.delta?.text) {
            text += message.delta.text;
        }

        // 5) candidates[].content.parts[].text
        const candidates = message.candidates;
        if (Array.isArray(candidates)) {
            candidates.forEach((c) => {
                const parts = c?.content?.parts;
                if (Array.isArray(parts)) {
                    parts.forEach((p) => {
                        if (p?.text) text += p.text;
                    });
                }
            });
        }

        // 6) serverContent.candidates[].content.parts[].text
        const scCandidates = message.serverContent?.candidates;
        if (Array.isArray(scCandidates)) {
            scCandidates.forEach((c) => {
                const parts = c?.content?.parts;
                if (Array.isArray(parts)) {
                    parts.forEach((p) => {
                        if (p?.text) text += p.text;
                    });
                }
            });
        }

        // 7) realtimeOutput.output[].content.parts[].text
        const rtOutput = message.realtimeOutput?.output;
        if (Array.isArray(rtOutput)) {
            rtOutput.forEach((o) => {
                const parts = o?.content?.parts;
                if (Array.isArray(parts)) {
                    parts.forEach((p) => {
                        if (p?.text) text += p.text;
                    });
                }
            });
        }

        // 8) output[].content.parts[].text
        const outArray = message.output;
        if (Array.isArray(outArray)) {
            outArray.forEach((o) => {
                const parts = o?.content?.parts;
                if (Array.isArray(parts)) {
                    parts.forEach((p) => {
                        if (p?.text) text += p.text;
                    });
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

        // Resolve any pending waiters for turn completion
        try {
            const resolvers = this.pendingTurnResolvers.splice(0);
            resolvers.forEach((resolve) => resolve(finalText || ""));
        } catch (_) {}
    }

    processBufferedChunks() {
        const audioChunks = [...this.pendingAudioChunks];
        this.pendingAudioChunks = [];
        audioChunks.forEach((base64Data) => {
            this.sendAudioChunk(base64Data);
        });

        // Optional safety: do NOT flush stale video frames on setup complete
        // Clear any queued frames to ensure only current-tab frames are sent
        if (this.pendingVideoFrames.length > 0) {
            streamingLogger.logInfo(
                `DROP ${this.pendingVideoFrames.length} queued video frames on setupComplete`
            );
        }
        this.pendingVideoFrames = [];
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

    clearPendingVideoFrames() {
        this.pendingVideoFrames = [];
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
        this.activeUtterance = false;
        this.clearBuffers();

        // Stop streaming logger
        streamingLogger.stop();

        // Resolve any pending turn waiters on explicit disconnect
        try {
            const resolvers = this.pendingTurnResolvers.splice(0);
            resolvers.forEach((resolve) => resolve(null));
        } catch (_) {}
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

    hasActiveUtterance() {
        return this.activeUtterance === true;
    }

    // Await completion of the current turn; resolves with final text or null on disconnect
    waitForTurnCompletion() {
        return new Promise((resolve) => {
            this.pendingTurnResolvers.push(resolve);
        });
    }
}
