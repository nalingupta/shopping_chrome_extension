import { API_CONFIG } from '../config/api-keys.js';

export class PipecatStreamingService {
    constructor() {
        this.session = null;
        this.dailyCallObject = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.roomUrl = null;
        
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
            
            // Step 1: Ensure agent exists (create if needed)
            console.log('🔧 Ensuring agent exists...');
            const agentResult = await this.ensureAgentExists();
            if (!agentResult.success) {
                console.log('⚠️ Agent creation/check failed, continuing anyway...');
                // Don't fail here - agent might already exist
            }
            
            // Step 2: Start a Pipecat Cloud agent session
            console.log('🚀 Starting agent session...');
            const sessionResponse = await this.startPipecatSession();
            if (!sessionResponse.success) {
                throw new Error(sessionResponse.error);
            }
            
            // Step 3: Get screen sharing permission
            console.log('🖥️ Setting up screen sharing...');
            await this.setupScreenSharing();
            
            // Step 4: Connect to Daily room created by Pipecat
            console.log('📞 Connecting to Daily room...');
            await this.connectToDaily(sessionResponse.roomUrl);
            
            // Step 5: Start screen + audio streaming
            console.log('📺 Starting screen + audio stream...');
            await this.startScreenStreamToDaily();
            
            this.isStreaming = true;
            
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

    async startPipecatSession() {
        try {
            const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
            const apiUrl = `${API_CONFIG.PIPECAT_CLOUD_API_URL}/agents/${agentName}/start`;
            
            console.log('🚀 Starting session with deployed agent...');
            console.log('📍 API URL:', apiUrl);
            console.log('🔑 Using JWT token:', API_CONFIG.PIPECAT_JWT_TOKEN.substring(0, 10) + '...');
            
            // For deployed agents, we don't send configuration - it's already deployed with config
            const requestBody = {
                createDailyRoom: true
                // No config needed - agent is already deployed with API keys
            };
            
            console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_CONFIG.PIPECAT_JWT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            console.log('📥 Response status:', response.status);
            console.log('📥 Response headers:', [...response.headers.entries()]);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Pipecat API error response:', errorText);
                throw new Error(`Pipecat session start failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('✅ Pipecat session started with deployed agent:', data);
            
            return {
                success: true,
                roomUrl: data.room_url,
                sessionId: data.session_id
            };
        } catch (error) {
            console.error('❌ Pipecat session start error:', error);
            return { success: false, error: error.message };
        }
    }

    async connectToDaily(roomUrl) {
        try {
            // Import Daily.co dynamically
            const { DailyIframe } = await import('@daily-co/daily-js');
            
            // Create Daily call object
            this.dailyCallObject = DailyIframe.createCallObject({
                url: roomUrl
            });
            
            // Setup Daily event handlers
            this.setupDailyEventHandlers();
            
            // Join the Daily room created by Pipecat
            await this.dailyCallObject.join();
            
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
            // Request screen capture permission via Chrome extension API
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen'],
                    (streamId) => {
                        if (streamId) {
                            resolve(streamId);
                        } else {
                            reject(new Error('Screen capture permission denied'));
                        }
                    }
                );
            });
            
            // Get screen stream
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
            
            return true;
        } catch (error) {
            throw new Error(`Screen sharing setup failed: ${error.message}`);
        }
    }

    async startScreenStreamToDaily() {
        if (!this.screenStream || !this.dailyCallObject) {
            throw new Error('Screen stream or Daily connection not available');
        }
        
        try {
            // Create a composite stream that includes screen video and microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000 // Pipecat requirement
                }
            });
            
            // Combine screen video with microphone audio
            const combinedStream = new MediaStream([
                ...this.screenStream.getVideoTracks(),
                ...audioStream.getAudioTracks()
            ]);
            
            // Send combined stream to Daily (which forwards to Pipecat agent)
            await this.dailyCallObject.setLocalAudio(true);
            await this.dailyCallObject.setLocalVideo(true);
            
            // Set the custom combined stream
            await this.dailyCallObject.updateInputSettings({
                video: {
                    mediaStream: combinedStream
                },
                audio: {
                    mediaStream: combinedStream
                }
            });
            
            console.log('📺 Screen + audio streaming to Pipecat via Daily');
            return true;
        } catch (error) {
            throw new Error(`Failed to start screen stream: ${error.message}`);
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

    async stopStreaming() {
        if (!this.isStreaming) {
            return { success: false, error: 'Not currently streaming' };
        }
        
        try {
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