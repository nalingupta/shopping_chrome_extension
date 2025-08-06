import { API_CONFIG } from "../config/api-keys.js";
import { ConversationHistoryManager } from "../utils/storage.js";

export class WebSocketManager {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSetupComplete = false;
        this.callbacks = {
            onMessage: null,
            onConnectionStateChange: null,
            onError: null,
        };
        this.messageQueue = [];
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
    }

    async initialize() {
        console.log(
            "🔌 WebSocketManager: Initializing persistent WebSocket connection"
        );
        return this.connect();
    }

    async connect() {
        if (
            this.isConnected &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
        ) {
            console.log("🔌 WebSocketManager: Already connected");
            return { success: true };
        }

        console.log("🔌 WebSocketManager: Creating new WebSocket connection");

        return new Promise((resolve, reject) => {
            try {
                this.isConnected = false;
                this.isSetupComplete = false;

                const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_CONFIG.GEMINI_API_KEY}`;

                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = "blob";

                this.ws.onopen = async () => {
                    console.log("✅ WebSocketManager: WebSocket connected");
                    this.isConnected = true;
                    this.reconnectAttempts = 0;

                    // Wait a bit for the connection to stabilize
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    console.log(
                        "📤 WebSocketManager: Sending configuration..."
                    );
                    this.sendConfiguration();
                    this.startKeepAlive();

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
                    console.error(
                        "❌ WebSocketManager: WebSocket error:",
                        error
                    );
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                    reject(new Error("WebSocket connection failed"));
                };

                this.ws.onclose = (event) => {
                    console.log(
                        `🔌 WebSocketManager: WebSocket closed - Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`
                    );

                    // Log potential causes based on close code
                    if (event.code === 1000) {
                        console.log(
                            "🔌 WebSocketManager: Normal closure (code 1000)"
                        );
                    } else if (event.code === 1001) {
                        console.log(
                            "🔌 WebSocketManager: Going away (code 1001) - server shutdown or page navigation"
                        );
                    } else if (event.code === 1002) {
                        console.log(
                            "🔌 WebSocketManager: Protocol error (code 1002)"
                        );
                    } else if (event.code === 1006) {
                        console.log(
                            "🔌 WebSocketManager: Abnormal closure (code 1006) - connection lost"
                        );
                    } else if (event.code === 1007) {
                        console.log(
                            "🔌 WebSocketManager: Invalid payload (code 1007) - protocol violation"
                        );
                    } else if (event.code === 1011) {
                        console.log(
                            "🔌 WebSocketManager: Server error (code 1011)"
                        );
                    } else if (event.code === 1012) {
                        console.log(
                            "🔌 WebSocketManager: Service restart (code 1012)"
                        );
                    } else if (event.code === 1013) {
                        console.log(
                            "🔌 WebSocketManager: Try again later (code 1013)"
                        );
                    } else {
                        console.log(
                            `🔌 WebSocketManager: Unknown close code: ${event.code}`
                        );
                    }

                    this.isConnected = false;
                    this.isSetupComplete = false;
                    this.stopKeepAlive();

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("disconnected");
                    }

                    // Auto-reconnect if not manually closed
                    if (
                        event.code !== 1000 &&
                        this.reconnectAttempts < this.maxReconnectAttempts
                    ) {
                        this.scheduleReconnection();
                    }
                };
            } catch (error) {
                console.error(
                    "❌ WebSocketManager: Connection setup failed:",
                    error
                );
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
                            text: "You are a helpful shopping assistant that helps users with their shopping needs. You can analyze web pages, answer questions about products, and provide shopping advice.",
                        },
                    ],
                },
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1024,
                    responseModalities: ["TEXT"],
                },
            },
        };

        this.sendMessage(setupMessage);
    }

    async sendTextMessage(text, screenshotDataUrl = null) {
        // Wait for setup to complete if not already done
        if (!this.isSetupComplete) {
            console.log(
                "⏳ WebSocketManager: Waiting for setup to complete..."
            );
            await this.waitForSetup();
        }

        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            console.warn(
                "⚠️ WebSocketManager: Cannot send text message - not ready"
            );
            return Promise.reject(new Error("WebSocket not ready"));
        }

        console.log("💬 WebSocketManager: Sending text message");

        // Load conversation history for context
        const conversationHistory =
            await ConversationHistoryManager.getContextForAPI();

        // Build the message with conversation history
        const turns = [];

        // Add conversation history as previous turns
        if (conversationHistory.length > 0) {
            console.log(
                `🧠 WebSocketManager: Including ${conversationHistory.length} conversation history messages`
            );
            turns.push(...conversationHistory);
        }

        // Add current user message
        const parts = [{ text: text }];

        // Add screenshot if provided
        if (screenshotDataUrl) {
            const base64Data = screenshotDataUrl.includes(",")
                ? screenshotDataUrl.split(",")[1]
                : screenshotDataUrl;

            parts.push({
                inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data,
                },
            });
        }

        turns.push({
            role: "user",
            parts: parts,
        });

        const message = {
            clientContent: {
                turns: turns,
            },
        };

        this.sendMessage(message);

        // Save user message to conversation history
        ConversationHistoryManager.saveMessageSync(text, "user");

        // Return a promise that resolves when we get a response
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(
                    "⏰ WebSocketManager: Text message timeout (30s)"
                );
                reject(new Error("Text message timeout"));
            }, 30000);

            const originalCallback = this.callbacks.onMessage;
            this.callbacks.onMessage = (response) => {
                clearTimeout(timeout);
                this.callbacks.onMessage = originalCallback;

                // Save assistant response to conversation history
                ConversationHistoryManager.saveMessageSync(
                    response.text,
                    "assistant"
                );

                resolve(response);
            };
        });
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const messageJson = JSON.stringify(message);
                // Only log non-media messages to reduce console noise
                if (
                    !message.realtimeInput?.audio &&
                    !message.realtimeInput?.mediaChunks
                ) {
                    console.log(
                        "📤 WebSocketManager: Sending message:",
                        messageJson.substring(0, 200) +
                            (messageJson.length > 200 ? "..." : "")
                    );
                }
                this.ws.send(messageJson);
            } catch (error) {
                console.error(
                    "❌ WebSocketManager: Failed to send message:",
                    error
                );
            }
        } else {
            console.warn(
                "⚠️ WebSocketManager: WebSocket not open, queuing message"
            );
            this.messageQueue.push(message);
        }
    }

    handleMessage(data) {
        try {
            console.log(
                "📨 WebSocketManager: Received message:",
                data.substring(0, 200) + (data.length > 200 ? "..." : "")
            );
            const message = JSON.parse(data);

            // Debug setup completion detection
            if (!this.isSetupComplete) {
                console.log(
                    "🔍 WebSocketManager: Checking for setup completion..."
                );
                console.log("   Message keys:", Object.keys(message));
                if (message.serverContent) {
                    console.log(
                        "   serverContent keys:",
                        Object.keys(message.serverContent)
                    );
                }
            }

            // Check for setup completion
            if (
                message.setupComplete !== undefined ||
                message.setup_complete !== undefined ||
                message.setupCompleted !== undefined ||
                (message.serverContent &&
                    message.serverContent.setupComplete) ||
                (message.serverContent && message.serverContent.setup) ||
                (message.setup && message.setup.complete)
            ) {
                console.log("✅ WebSocketManager: Setup complete");
                this.isSetupComplete = true;
                return;
            }

            // Check for error response
            if (message.error) {
                console.error(
                    "❌ WebSocketManager: Received error:",
                    message.error
                );
                if (this.callbacks.onError) {
                    this.callbacks.onError(message.error);
                }
                return;
            }

            // Fallback: Any non-error serverContent message after setup attempt
            if (!this.isSetupComplete && message.serverContent) {
                console.log(
                    "✅ WebSocketManager: Setup complete (fallback detection)"
                );
                this.isSetupComplete = true;
                return;
            }

            // Handle normal response
            if (message.serverContent && message.serverContent.turns) {
                const response = {
                    text:
                        message.serverContent.turns[0]?.parts[0]?.text ||
                        "No response text",
                };

                if (this.callbacks.onMessage) {
                    this.callbacks.onMessage(response);
                }
            }
        } catch (error) {
            console.error("❌ WebSocketManager: Error parsing message:", error);
        }
    }

    startKeepAlive() {
        this.keepAliveTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const keepAliveMessage = {
                    realtimeInput: {
                        mediaChunks: [],
                    },
                };
                this.sendMessage(keepAliveMessage);
            }
        }, 45000); // Every 45 seconds
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    scheduleReconnection() {
        this.reconnectAttempts++;
        const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            10000
        );

        console.log(
            `🔄 WebSocketManager: Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
        );

        this.reconnectTimer = setTimeout(() => {
            this.connect().catch((error) => {
                console.error(
                    "❌ WebSocketManager: Reconnection failed:",
                    error
                );
            });
        }, delay);
    }

    async disconnect() {
        console.log("🔌 WebSocketManager: Disconnecting");

        this.stopKeepAlive();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close(1000, "Manual disconnect");
            this.ws = null;
        }

        this.isConnected = false;
        this.isSetupComplete = false;
    }

    setMessageCallback(callback) {
        this.callbacks.onMessage = callback;
    }

    setConnectionStateCallback(callback) {
        this.callbacks.onConnectionStateChange = callback;
    }

    setErrorCallback(callback) {
        this.callbacks.onError = callback;
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isSetupComplete: this.isSetupComplete,
            wsReadyState: this.ws ? this.ws.readyState : null,
        };
    }

    isReadyForMessages() {
        return (
            this.isSetupComplete &&
            this.ws &&
            this.ws.readyState === WebSocket.OPEN
        );
    }

    async waitForSetup() {
        return new Promise((resolve, reject) => {
            if (this.isSetupComplete) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                console.error("⏰ WebSocketManager: Setup timeout (10s)");
                reject(new Error("Setup timeout"));
            }, 10000);

            const checkSetup = () => {
                if (this.isSetupComplete) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkSetup, 100);
                }
            };
            checkSetup();
        });
    }

    // Send audio chunk through WebSocket
    sendAudioChunk(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            console.warn(
                "⚠️ WebSocketManager: Cannot send audio chunk - not ready"
            );
            return;
        }

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

    // Send video frame through WebSocket
    sendVideoFrame(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            console.warn(
                "⚠️ WebSocketManager: Cannot send video frame - not ready"
            );
            return;
        }

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
}
