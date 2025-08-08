import { API_CONFIG } from "../config/api-keys.js";
import { streamingLogger } from "../utils/streaming-logger.js";
import { SYSTEM_PROMPT } from "../prompt/system-prompt.js";
import { ContextAssembler } from "./prompt/context-assembler.js";

export class GeminiRealtimeClient {
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
        this.audioInputEnabled = false;
        this._connectSeq = 0; // debug: connection attempts

        // Utterance-level diagnostics
        this._utteranceCounters = {
            audioChunks: 0,
            videoFrames: 0,
            firstAudioAt: null,
            firstVideoAt: null,
        };
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

                // Debug: mark new connection attempt
                this._connectSeq += 1;
                try {
                    console.debug(
                        `[RealtimeClient] connect() attempt #${this._connectSeq}`
                    );
                } catch (_) {}

                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = "blob";

                this.ws.onopen = async () => {
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
                    try {
                        console.error("[RealtimeClient] WS onerror:", error);
                    } catch (_) {}
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

                    try {
                        console.warn(
                            `[RealtimeClient] WS onclose: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
                        );
                    } catch (_) {}

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
                            text: SYSTEM_PROMPT,
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

        try {
            console.debug(
                `[RealtimeClient] Sending setup. systemPromptLen=${
                    (SYSTEM_PROMPT || "").length
                }`
            );
        } catch (_) {}
        this.sendMessage(setupMessage);
    }

    // Utterance diagnostics helpers
    markUtteranceStart() {
        this._utteranceCounters = {
            audioChunks: 0,
            videoFrames: 0,
            firstAudioAt: null,
            firstVideoAt: null,
        };
        try {
            console.debug(`[RealtimeClient] utteranceStart at ${Date.now()}`);
        } catch (_) {}
    }

    logUtteranceEnd(elapsedMs) {
        try {
            console.debug(
                `[RealtimeClient] utteranceEnd after ${elapsedMs}ms audioChunks=${this._utteranceCounters.audioChunks} videoFrames=${this._utteranceCounters.videoFrames} firstAudioAt=${this._utteranceCounters.firstAudioAt} firstVideoAt=${this._utteranceCounters.firstVideoAt}`
            );
        } catch (_) {}
    }

    // Deprecated: text chunks over realtimeInput are not used anymore
    sendTextChunk(_) {}

    // One-time conversation history after setupComplete
    sendConversationHistory(contents) {
        if (!Array.isArray(contents) || contents.length === 0) return;
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        // Batch all turns into a single clientContent message
        const safeTurns = contents
            .filter((t) => t && t.role && t.parts)
            .map((t) => ({
                // Live WS expects assistant turns labeled as "assistant" (not "model")
                role: t.role === "model" ? "assistant" : t.role,
                parts: t.parts,
            }));
        try {
            const roleCounts = safeTurns.reduce(
                (acc, t) => ((acc[t.role] = (acc[t.role] || 0) + 1), acc),
                {}
            );
            const previews = safeTurns.slice(0, 2).map((t, i) => {
                const textPreview = (t?.parts?.[0]?.text || "").slice(0, 60);
                return `${i}:${t.role}=${JSON.stringify(textPreview)}`;
            });
            console.debug(
                `[RealtimeClient] ConversationHistory send | turns=${
                    safeTurns.length
                } | roles user=${roleCounts.user || 0} assistant=${
                    roleCounts.assistant || 0
                } | previews ${previews.join(" ")}`
            );
        } catch (_) {}
        if (safeTurns.length > 0) {
            const message = { clientContent: { turns: safeTurns } };
            this.sendMessage(message);
        }
    }

    // Per-turn finalized user message only
    sendUserMessage(text) {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!trimmed) return;
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        try {
            const preview = JSON.stringify(trimmed.slice(0, 80));
            console.debug(
                `[RealtimeClient] UserMessage send | len=${trimmed.length} | preview=${preview}`
            );
        } catch (_) {}
        const message = {
            clientContent: {
                turns: [
                    {
                        role: "user",
                        parts: [{ text: trimmed }],
                    },
                ],
            },
        };
        this.sendMessage(message);
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

        // Utterance diagnostics: first-chunk and counter
        try {
            if (this._utteranceCounters.audioChunks === 0) {
                this._utteranceCounters.firstAudioAt = Date.now();
                console.debug(
                    `[RealtimeClient] first audio chunk this utterance. audioInputEnabled=${this.audioInputEnabled}`
                );
            }
            this._utteranceCounters.audioChunks += 1;
        } catch (_) {}

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
            // Drop frame when not ready; do not buffer to avoid stale sends
            streamingLogger.logInfo("DROP video frame (setup not ready)");
            return;
        }

        // Log video frame for streaming statistics
        streamingLogger.logVideoFrame(base64Data.length);

        // Utterance diagnostics: first-frame and counter
        try {
            if (this._utteranceCounters.videoFrames === 0) {
                this._utteranceCounters.firstVideoAt = Date.now();
            }
            this._utteranceCounters.videoFrames += 1;
        } catch (_) {}

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
            return;
        }
        const message = { realtimeInput: { activityStart: {} } };
        try {
            this.ws.send(JSON.stringify(message));
            streamingLogger.logInfo("↗️ Sent activityStart");
            console.debug(`[RealtimeClient] activityStart at ${Date.now()}`);
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
            console.debug(`[RealtimeClient] activityEnd at ${Date.now()}`);
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
                try {
                    console.error(
                        "[RealtimeClient] Failed to send message. readyState=",
                        this.ws?.readyState,
                        error
                    );
                } catch (_) {}
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

            if (
                message.setupComplete !== undefined ||
                message.setup_complete !== undefined
            ) {
                this.isSetupComplete = true;
                this.processBufferedChunks();
                try {
                    console.debug("[RealtimeClient] SetupComplete");
                } catch (_) {}
                // Immediately send conversation history as clientContent turns (no media yet)
                (async () => {
                    try {
                        const history =
                            await ContextAssembler.buildHistoryContents();
                        if (history?.length) {
                            this.sendConversationHistory(history);
                        }
                    } catch (e) {
                        console.warn("[RealtimeClient] history send failed", e);
                    }
                })();
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

                // Send real-time streaming update to UI (ChatGPT-style)
                if (this.callbacks.onStreamingUpdate) {
                    this.callbacks.onStreamingUpdate({
                        text: this.currentStreamingResponse,
                        isStreaming: true,
                        isComplete: false,
                        timestamp: Date.now(),
                    });
                }
                try {
                    console.debug(
                        `[RealtimeClient] chunk received len=${chunkText.length}`
                    );
                } catch (_) {}
            }

            // Only rely on explicit turn completion flag from Gemini
            const isTurnComplete =
                message.serverContent?.turnComplete === true ||
                message.serverContent?.turn_complete === true ||
                message.turnComplete === true ||
                message.turn_complete === true;

            if (isTurnComplete) {
                this.isProcessingTurn = true;
                try {
                    console.debug(
                        `[RealtimeClient] turnComplete. finalLen=${this.currentStreamingResponse.length}`
                    );
                } catch (_) {}
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

        try {
            console.warn(
                `[RealtimeClient] scheduleReconnection attempt=${this.reconnectAttempts} delayMs=${delay}`
            );
        } catch (_) {}

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
