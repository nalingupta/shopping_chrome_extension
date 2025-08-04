import { API_CONFIG } from '../config/api-keys.js';

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
        this.callbacks = {
            onBotResponse: null,
            onConnectionStateChange: null,
            onError: null
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
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000
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
                this.ws.binaryType = 'blob';
                
                this.ws.onopen = async () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                    this.sendConfiguration();
                    this.startKeepAlive();
                    
                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange('connected');
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
                    reject(new Error('WebSocket connection failed'));
                };
                
                this.ws.onclose = (event) => {
                    this.isConnected = false;
                    this.isSetupComplete = false;
                    this.stopKeepAlive();
                    this.clearBuffers();
                    
                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange('disconnected');
                    }
                    
                    if (!this.isManualStop && this.reconnectAttempts < this.maxReconnectAttempts) {
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
                    parts: [{
                        text: `You are a helpful shopping assistant with real-time access to both visual and audio input from the user.

You can see the user's screen (including web pages, shopping sites, product listings) and hear their questions through their microphone.

Your capabilities:
- Analyze product listings, prices, and reviews on any website in real-time
- Compare products across different sites as the user browses
- Provide shopping recommendations based on what you see on screen
- Answer questions about products visible on the screen
- Help with price comparisons and deal analysis
- Identify product features from images/videos on the page

When responding:
1. Look at what's currently displayed on their screen
2. Analyze any products, prices, or shopping content visible
3. Provide helpful, specific recommendations based on what you can see
4. Be conversational and natural in your responses
5. If you can't see specific shopping content, ask them to navigate to the product they want help with

Remember: You have LIVE access to their screen and audio, so you can see exactly what they're looking at and respond in real-time.`
                    }]
                },
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                    candidateCount: 1,
                    responseModalities: ["TEXT"]
                }
            }
        };
        
        this.sendMessage(setupMessage);
    }

    sendAudioChunk(base64Data) {
        if (!this.isSetupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.pendingAudioChunks.push(base64Data);
            return;
        }
        
        const message = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: "audio/pcm;rate=16000"
                }
            }
        };
        this.sendMessage(message);
    }

    sendVideoFrame(base64Data) {
        if (!this.isSetupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.pendingVideoFrames.push(base64Data);
            return;
        }
        
        const message = {
            realtimeInput: {
                mediaChunks: [{
                    mimeType: "image/jpeg",
                    data: base64Data
                }]
            }
        };
        this.sendMessage(message);
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Failed to send message:', error);
            }
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            
            if (message.setupComplete !== undefined || message.setup_complete !== undefined) {
                this.isSetupComplete = true;
                this.processBufferedChunks();
                return;
            }
            
            this.responseQueue.push(message);
            this.processResponseQueue();
            
        } catch (error) {
            console.error('Error parsing Gemini message:', error);
        }
    }

    async processResponseQueue() {
        if (this.isProcessingTurn) {
            return;
        }

        while (this.responseQueue.length > 0) {
            const message = this.responseQueue.shift();
            this.currentTurn.push(message);

            if (message.serverContent && message.serverContent.turnComplete) {
                this.isProcessingTurn = true;
                await this.handleCompleteTurn(this.currentTurn);
                this.currentTurn = [];
                this.isProcessingTurn = false;
                break;
            }
        }
    }

    async handleCompleteTurn(turnMessages) {
        let combinedText = '';
        
        turnMessages.forEach((message) => {
            if (message.serverContent && message.serverContent.modelTurn && message.serverContent.modelTurn.parts) {
                message.serverContent.modelTurn.parts.forEach((part) => {
                    if (part.text) {
                        combinedText += part.text;
                    }
                });
            }
            
            if (message.error) {
                console.error('Gemini API error:', message.error);
                if (this.callbacks.onError) {
                    this.callbacks.onError(message.error);
                }
            }
        });

        if (combinedText && this.callbacks.onBotResponse) {
            this.callbacks.onBotResponse({
                text: combinedText,
                timestamp: Date.now()
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
            if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isManualStop) {
                const keepAliveMessage = {
                    realtimeInput: {
                        mediaChunks: []
                    }
                };
                
                try {
                    this.ws.send(JSON.stringify(keepAliveMessage));
                } catch (error) {
                    console.error('Keep-alive failed:', error);
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
        
        const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000);
        this.reconnectAttempts++;
        
        this.reconnectTimer = setTimeout(async () => {
            if (!this.isManualStop) {
                try {
                    await this.connect();
                } catch (error) {
                    console.error('Reconnection failed:', error);
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
        
        if (this.audioContext && this.audioContext.state === 'running') {
            await this.audioContext.suspend();
        }
        
        this.isConnected = false;
        this.isSetupComplete = false;
        this.clearBuffers();
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

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isSetupComplete: this.isSetupComplete
        };
    }
}