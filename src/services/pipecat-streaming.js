import { API_CONFIG } from '../config/api-keys.js';

export class PipecatStreamingService {
    constructor() {
        this.session = null;
        this.dailyCallObject = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.roomUrl = null;
        this.keepAliveInterval = null;
        
        // Callbacks
        this.callbacks = {
            onUserTranscript: null,
            onBotTranscript: null,
            onBotResponse: null,
            onConnectionStateChange: null,
            onError: null
        };
        
        // Screen sharing stream
        this.screenStream = null;
        this.mediaRecorder = null;
        this.videoChunks = [];
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Pipecat Cloud...');
            
            // Pipecat Cloud is auto-configured with API keys - no initialization needed!
            // The cloud service handles all the backend infrastructure
            
            return { success: true, message: 'Pipecat Cloud ready - no server deployment needed!' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    setupEventHandlers() {
        if (!this.client) return;
        
        // Connection events
        this.client.on('connected', () => {
            this.isConnected = true;
            console.log('PipeChat connected');
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange('connected');
            }
        });
        
        this.client.on('disconnected', () => {
            this.isConnected = false;
            this.isStreaming = false;
            console.log('PipeChat disconnected');
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange('disconnected');
            }
        });
        
        // User speech events
        this.client.on('userTranscript', (data) => {
            console.log('User transcript:', data);
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript(data);
            }
        });
        
        // Bot response events
        this.client.on('botTranscript', (data) => {
            console.log('Bot transcript:', data);
            if (this.callbacks.onBotTranscript) {
                this.callbacks.onBotTranscript(data);
            }
        });
        
        this.client.on('botResponse', (data) => {
            console.log('Bot response:', data);
            if (this.callbacks.onBotResponse) {
                this.callbacks.onBotResponse(data);
            }
        });
        
        // Error events
        this.client.on('error', (error) => {
            console.error('PipeChat error:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
        });
    }

    async startStreaming() {
        if (this.isStreaming) {
            return { success: false, error: 'Already streaming' };
        }
        
        try {
            console.log('🌟 Starting Pipecat Cloud session...');
            console.log('🔍 DEBUG: Checking if we get to each step...');
            
            // Step 1: Start a Pipecat Cloud agent session
            console.log('🚀 Step 1: Starting agent session...');
            const sessionResponse = await this.startPipecatSession();
            if (!sessionResponse.success) {
                console.error('💥 Step 1 FAILED:', sessionResponse.error);
                throw new Error(sessionResponse.error);
            }
            console.log('✅ Step 1 SUCCESS: Agent session started');
            
            // Step 2: Get screen sharing permission
            console.log('🖥️ Step 2: Setting up screen sharing...');
            try {
                await this.setupScreenSharing();
                console.log('✅ Step 2 SUCCESS: Screen sharing setup complete');
            } catch (screenError) {
                console.error('💥 Step 2 FAILED:', screenError.message);
                console.log('⚠️ CONTINUING WITHOUT SCREEN SHARING - bot will give generic responses');
                // Don't throw here - let it continue with audio only
            }
            
            // Step 3: Connect to Daily room created by Pipecat
            console.log('📞 Step 3: Connecting to Daily room...');
            await this.connectToDaily(sessionResponse.roomUrl, sessionResponse.dailyToken);
            console.log('✅ Step 3 SUCCESS: Connected to Daily room');
            
            // Step 4: Start screen + audio streaming
            console.log('📺 Step 4: Starting screen + audio stream...');
            try {
                await this.startScreenStreamToDaily();
                console.log('✅ Step 4 SUCCESS: Multimodal streaming active (screen + audio)');
            } catch (streamError) {
                console.error('💥 Step 4 FAILED:', streamError.message);
                console.log('⚠️ AUDIO-ONLY MODE - enabling audio without screen');
                // Try audio-only mode
                await this.startAudioOnlyMode();
            }
            
            this.isStreaming = true;
            console.log('🎉 STREAMING STARTED - Bot should now respond to your voice!');
            
            return { success: true, message: 'Real-time streaming started with Pipecat Cloud' };
        } catch (error) {
            console.error('❌ Streaming start error:', error);
            return { success: false, error: error.message };
        }
    }

    async ensureAgentExists() {
        try {
            const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
            console.log('🤖 Using deployed Pipecat agent:', agentName);
            
            // Agent should already be deployed via Pipecat Cloud CLI
            // No need to create it via API - just verify it exists
            const checkAgentUrl = `${API_CONFIG.PIPECAT_CLOUD_API_URL}/agents/${agentName}`;
            
            const response = await fetch(checkAgentUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${API_CONFIG.PIPECAT_JWT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Deployed agent found:', data);
                return { success: true, agent: data };
            } else {
                const errorText = await response.text();
                console.log('⚠️ Deployed agent not found:', response.status, errorText);
                console.log('💡 Please deploy the agent using: pcc deploy shopping-assistant YOUR_DOCKER_USERNAME/shopping-assistant:0.1 --secrets shopping-assistant-secrets');
                return { success: false, error: `Agent not deployed: ${response.status} - ${errorText}` };
            }
        } catch (error) {
            console.log('⚠️ Agent check error:', error);
            return { success: false, error: error.message };
        }
    }

    async startPipecatSession(retryCount = 0, maxRetries = 3) {
        try {
            const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
            const apiUrl = `${API_CONFIG.PIPECAT_CLOUD_API_URL}/${agentName}/start`;
            
            console.log(`🚀 Starting session with deployed agent (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            console.log('📍 API URL:', apiUrl);
            console.log('🔑 Using public API key:', API_CONFIG.PIPECAT_PUBLIC_API_KEY);
            
            // Correct payload format for public API
            const requestBody = {
                createDailyRoom: true,
                body: {}
            };
            
            console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
            
            // Use public API key (stable, no expiration)
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_CONFIG.PIPECAT_PUBLIC_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            console.log('📥 Response status:', response.status);
            console.log('📥 Response headers:', [...response.headers.entries()]);

            // Handle 401 errors with retry logic for cold starts
            if (response.status === 401 && retryCount < maxRetries) {
                const errorText = await response.text();
                console.warn(`⚠️ 401 Error (likely cold start), retrying in ${(retryCount + 1) * 2} seconds...`);
                console.log('🧊 Cold start detected - agent is spinning up...');
                
                // Exponential backoff: 2s, 4s, 6s
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
                
                // Recursive retry
                return await this.startPipecatSession(retryCount + 1, maxRetries);
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Pipecat API error response:', errorText);
                
                if (response.status === 401) {
                    throw new Error(`Authentication failed after ${maxRetries + 1} attempts. Please check your JWT token.`);
                }
                
                throw new Error(`Pipecat session start failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Pipecat session started with deployed agent:', data);
            
            // Start keep-alive pings to prevent scale-to-zero
            this.startKeepAlive();
            
            return {
                success: true,
                roomUrl: data.dailyRoom,
                dailyToken: data.dailyToken,
                sessionId: data.sessionId
            };
        } catch (error) {
            console.error('❌ Pipecat session start error:', error);
            return { success: false, error: error.message };
        }
    }

    async connectToDaily(roomUrl, dailyToken) {
        try {
            // Import Daily.co dynamically
            const { DailyIframe } = await import('@daily-co/daily-js');
            
            // Create Daily call object
            this.dailyCallObject = DailyIframe.createCallObject({
                url: roomUrl
            });
            
            // Setup Daily event handlers
            this.setupDailyEventHandlers();
            
            // Join the Daily room created by Pipecat with token
            await this.dailyCallObject.join({
                token: dailyToken
            });
            
            this.isConnected = true;
            console.log('✅ Connected to Daily room created by Pipecat');
            
        } catch (error) {
            throw new Error(`Daily connection failed: ${error.message}`);
        }
    }

    setupDailyEventHandlers() {
        if (!this.dailyCallObject) return;
        
        this.dailyCallObject.on('joined-meeting', () => {
            console.log('📞 Joined Daily meeting');
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange('connected');
            }
        });
        
        this.dailyCallObject.on('left-meeting', () => {
            console.log('📞 Left Daily meeting');
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange('disconnected');
            }
        });
        
        // Handle AI responses from Pipecat agent
        this.dailyCallObject.on('participant-joined', (event) => {
            if (event.participant.user_name === 'Pipecat-Agent') {
                console.log('🤖 Pipecat AI agent joined');
            }
        });
        
        // Handle transcription events if available
        this.dailyCallObject.on('app-message', (event) => {
            if (event.data.type === 'transcript') {
                if (event.data.is_final && this.callbacks.onBotResponse) {
                    this.callbacks.onBotResponse(event.data);
                }
            }
        });
        
        this.dailyCallObject.on('error', (error) => {
            console.error('Daily error:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
        });
    }

    async setupScreenSharing() {
        try {
            console.log('🖥️ Setting up screen sharing...');
            
            // Request screen capture permission via Chrome extension API
            console.log('📋 Requesting screen capture permission...');
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen', 'window', 'tab'], // Allow multiple source types
                    (streamId) => {
                        if (streamId) {
                            console.log('✅ Screen capture permission granted, streamId:', streamId);
                            resolve(streamId);
                        } else {
                            console.error('❌ Screen capture permission denied - user may have clicked Cancel or closed dialog');
                            reject(new Error('Screen capture permission denied'));
                        }
                    }
                );
            });
            
            // Get screen stream
            console.log('🎥 Getting screen stream...');
            this.screenStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: streamId,
                        maxWidth: 1280,
                        maxHeight: 720,
                        maxFrameRate: 15
                    }
                }
            });
            
            console.log('✅ Screen stream obtained:', this.screenStream);
            console.log('📊 Video tracks:', this.screenStream.getVideoTracks().length);
            if (this.screenStream.getVideoTracks().length > 0) {
                const track = this.screenStream.getVideoTracks()[0];
                console.log('🔧 Video track settings:', track.getSettings());
                console.log('🎯 Video track ready state:', track.readyState);
                console.log('📏 Video dimensions:', track.getSettings().width, 'x', track.getSettings().height);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Screen sharing setup failed:', error);
            
            if (error.message.includes('permission denied')) {
                console.log('💡 HELP: To use the Shopping Assistant:');
                console.log('  1. Click "Start a chat" again');
                console.log('  2. When the screen sharing dialog appears, choose "Entire Screen" or a specific window');
                console.log('  3. Click "Share" to grant permission');
                console.log('  4. The Shopping Assistant will then be able to see what you\'re looking at!');
            }
            
            throw new Error(`Screen sharing setup failed: ${error.message}`);
        }
    }

    async startScreenStreamToDaily() {
        if (!this.screenStream || !this.dailyCallObject) {
            console.error('❌ Missing screen stream or Daily connection');
            throw new Error('Screen stream or Daily connection not available');
        }
        
        try {
            console.log('🎤 Getting microphone audio...');
            // Create a composite stream that includes screen video and microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000 // Pipecat requirement
                }
            });
            
            console.log('🎵 Audio stream obtained:', audioStream);
            console.log('📊 Audio tracks:', audioStream.getAudioTracks().length);
            
            // Combine screen video with microphone audio
            const combinedStream = new MediaStream([
                ...this.screenStream.getVideoTracks(),
                ...audioStream.getAudioTracks()
            ]);
            
            console.log('🔗 Combined stream created:');
            console.log('  - Video tracks:', combinedStream.getVideoTracks().length);
            console.log('  - Audio tracks:', combinedStream.getAudioTracks().length);
            
            // Send combined stream to Daily (which forwards to Pipecat agent)
            console.log('🚀 Enabling Daily audio/video...');
            await this.dailyCallObject.setLocalAudio(true);
            await this.dailyCallObject.setLocalVideo(true);
            
            // Set the custom combined stream
            console.log('📡 Sending combined stream to Daily...');
            await this.dailyCallObject.updateInputSettings({
                video: {
                    mediaStream: combinedStream
                },
                audio: {
                    mediaStream: combinedStream
                }
            });
            
            console.log('✅ Screen + audio streaming to Pipecat via Daily');
            console.log('🎯 Pipecat agent should now be receiving your screen and audio!');
            return true;
        } catch (error) {
            console.error('❌ Failed to start screen stream:', error);
            throw new Error(`Failed to start screen stream: ${error.message}`);
        }
    }

    async startAudioOnlyMode() {
        try {
            console.log('🎤 Starting audio-only mode...');
            
            // Get microphone audio only
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            console.log('✅ Audio stream obtained for audio-only mode');
            
            // Enable audio in Daily
            await this.dailyCallObject.setLocalAudio(true);
            await this.dailyCallObject.setLocalVideo(false); // No video in audio-only mode
            
            // Set audio stream
            await this.dailyCallObject.updateInputSettings({
                audio: {
                    mediaStream: audioStream
                }
            });
            
            console.log('✅ Audio-only mode active - bot can hear you but cannot see screen');
            return true;
        } catch (error) {
            console.error('❌ Audio-only mode failed:', error);
            throw error;
        }
    }

    setupMediaRecorder(stream) {
        try {
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm; codecs=vp8,opus'
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.videoChunks.push(event.data);
                    
                    // Send chunks to PipeChat for real-time processing
                    if (this.client && this.isConnected) {
                        this.sendVideoChunkToPipeChat(event.data);
                    }
                }
            };
            
            // Start recording in small chunks for real-time processing
            this.mediaRecorder.start(1000); // 1 second chunks
            
        } catch (error) {
            console.error('MediaRecorder setup failed:', error);
        }
    }

    async sendVideoChunkToPipeChat(chunk) {
        try {
            // Convert chunk to base64 for transmission
            const base64Chunk = await this.blobToBase64(chunk);
            
            // Send to PipeChat server for Gemini processing
            if (this.client && this.client.sendMessage) {
                this.client.sendMessage({
                    type: 'video_chunk',
                    data: base64Chunk,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('Failed to send video chunk:', error);
        }
    }

    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    startKeepAlive() {
        // Clear any existing keep-alive
        this.stopKeepAlive();
        
        console.log('🔄 Starting keep-alive pings to prevent agent scale-down...');
        
        // Ping every 30 seconds to keep the agent warm
        this.keepAliveInterval = setInterval(async () => {
            try {
                const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
                const statusUrl = `${API_CONFIG.PIPECAT_CLOUD_API_URL}/${agentName}/start`;
                
                const response = await fetch(statusUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_CONFIG.PIPECAT_PUBLIC_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        createDailyRoom: false,
                        body: {}
                    })
                });
                
                if (response.ok) {
                    console.log('💓 Keep-alive ping successful');
                } else {
                    console.warn('⚠️ Keep-alive ping failed:', response.status);
                }
            } catch (error) {
                console.warn('⚠️ Keep-alive ping error:', error.message);
            }
        }, 30000); // 30 seconds
    }
    
    stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            console.log('🛑 Keep-alive pings stopped');
        }
    }

    async stopStreaming() {
        if (!this.isStreaming) {
            return { success: false, error: 'Not currently streaming' };
        }
        
        try {
            // Stop keep-alive pings
            this.stopKeepAlive();
            
            // Stop media recorder
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            
            // Stop screen stream
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
                this.screenStream = null;
            }
            
            // Disconnect from PipeChat
            if (this.client && this.isConnected) {
                await this.client.disconnect();
            }
            
            this.isStreaming = false;
            this.videoChunks = [];
            
            return { success: true, message: 'Streaming stopped' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Callback setters
    setUserTranscriptCallback(callback) {
        this.callbacks.onUserTranscript = callback;
    }

    setBotTranscriptCallback(callback) {
        this.callbacks.onBotTranscript = callback;
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

    // Status methods
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isStreaming: this.isStreaming,
            hasScreenStream: !!this.screenStream,
            serverUrl: this.serverUrl
        };
    }

    async testConnection() {
        if (!this.client) {
            return false;
        }
        
        try {
            // Send a ping message to test connection
            if (this.client.sendMessage) {
                this.client.sendMessage({
                    type: 'ping',
                    timestamp: Date.now()
                });
            }
            return true;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    cleanup() {
        // Stop keep-alive pings
        this.stopKeepAlive();
        
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state !== 'inactive') {
                    this.mediaRecorder.stop();
                }
            } catch (error) {
                console.error('Error stopping media recorder:', error);
            }
            this.mediaRecorder = null;
        }
        
        if (this.screenStream) {
            try {
                this.screenStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.error('Error stopping screen stream:', error);
            }
            this.screenStream = null;
        }
        
        if (this.client) {
            try {
                this.client.disconnect();
            } catch (error) {
                console.error('Error disconnecting client:', error);
            }
            this.client = null;
        }
        
        this.transport = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.videoChunks = [];
    }
}