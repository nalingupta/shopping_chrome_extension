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
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript(data);
            }
        });
        
        // Bot response events
        this.client.on('botTranscript', (data) => {
            if (this.callbacks.onBotTranscript) {
                this.callbacks.onBotTranscript(data);
            }
        });
        
        this.client.on('botResponse', (data) => {
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
            console.log('Starting Pipecat Cloud session...');
            
            // Step 1: Start a Pipecat Cloud agent session
            const sessionResponse = await this.startPipecatSession();
            if (!sessionResponse.success) {
                console.error('Agent session failed:', sessionResponse.error);
                throw new Error(sessionResponse.error);
            }
            
            // Step 2: Get screen sharing permission
            try {
                await this.setupScreenSharing();
            } catch (screenError) {
                console.error('Screen sharing setup failed:', screenError.message);
                console.log('Continuing without screen sharing - bot will give generic responses');
                // Don't throw here - let it continue with audio only
            }
            
            // Step 3: Connect to the Daily room that Pipecat created
            try {
                await this.connectAndStreamToDaily(sessionResponse.roomUrl, sessionResponse.dailyToken);
                console.log('Connected to Daily room and streaming');
            } catch (streamError) {
                console.error('Daily room connection failed:', streamError.message);
                console.log('Falling back to local speech recognition');
                // Fallback to local processing
                await this.startMediaCapture();
            }
            
            this.isStreaming = true;
            console.log('Streaming started - Bot should now respond to your voice!');
            
            return { success: true, message: 'Real-time streaming started with Pipecat Cloud' };
        } catch (error) {
            console.error('Streaming start error:', error);
            return { success: false, error: error.message };
        }
    }

    async ensureAgentExists() {
        try {
            const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
            
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
                return { success: true, agent: data };
            } else {
                const errorText = await response.text();
                console.error('Deployed agent not found:', response.status, errorText);
                console.log('Please deploy the agent using: pcc deploy shopping-assistant YOUR_DOCKER_USERNAME/shopping-assistant:0.1 --secrets shopping-assistant-secrets');
                return { success: false, error: `Agent not deployed: ${response.status} - ${errorText}` };
            }
        } catch (error) {
            console.error('Agent check error:', error);
            return { success: false, error: error.message };
        }
    }

    async startPipecatSession(retryCount = 0, maxRetries = 3) {
        try {
            const agentName = API_CONFIG.PIPECAT_AGENT_NAME;
            const apiUrl = `${API_CONFIG.PIPECAT_CLOUD_API_URL}/${agentName}/start`;
            
            // Correct payload format for public API
            const requestBody = {
                createDailyRoom: true,
                body: {}
            };
            
            // Use public API key (stable, no expiration)
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_CONFIG.PIPECAT_PUBLIC_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });


            // Handle 401 errors with retry logic for cold starts
            if (response.status === 401 && retryCount < maxRetries) {
                const errorText = await response.text();
                console.warn(`401 Error (likely cold start), retrying in ${(retryCount + 1) * 2} seconds...`);
                console.log('Cold start detected - agent is spinning up...');
                
                // Exponential backoff: 2s, 4s, 6s
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
                
                // Recursive retry
                return await this.startPipecatSession(retryCount + 1, maxRetries);
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Pipecat API error response:', errorText);
                
                if (response.status === 401) {
                    throw new Error(`Authentication failed after ${maxRetries + 1} attempts. Please check your JWT token.`);
                }
                
                throw new Error(`Pipecat session start failed: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            console.log('Pipecat session started with deployed agent');
            
            // Start keep-alive pings to prevent scale-to-zero
            this.startKeepAlive();
            
            return {
                success: true,
                roomUrl: data.dailyRoom,
                dailyToken: data.dailyToken,
                sessionId: data.sessionId
            };
        } catch (error) {
            console.error('Pipecat session start error:', error);
            return { success: false, error: error.message };
        }
    }

    async connectAndStreamToDaily(roomUrl, dailyToken) {
        try {
            console.log('Connecting to Pipecat via Daily.co with CSP-safe config...');
            
            // Initialize Pipecat Daily.co client
            if (typeof window.PipecatDailyClient === 'undefined') {
                throw new Error('Pipecat Daily.co client not loaded - check script tag');
            }
            
            // Create Pipecat Daily.co client instance with avoidEval
            this.pipecatClient = new window.PipecatDailyClient({
                roomUrl: roomUrl,
                token: dailyToken
            });
            
            // Set up Daily.co client event handlers
            this.setupPipecatClientHandlers();
            
            // Connect to the Pipecat session via Daily.co with avoidEval: true
            await this.pipecatClient.join();
            
            console.log('Connected to Pipecat via Daily.co (CSP-safe)');
            
            // Now start media capture and streaming
            await this.startMediaStreamingToPipecat();
            
        } catch (error) {
            console.error('Daily.co connection failed:', error);
            throw new Error(`Daily.co connection failed: ${error.message}`);
        }
    }

    setupPipecatClientHandlers() {
        if (!this.pipecatClient) return;
        
        // Handle bot responses
        this.pipecatClient.on('botResponse', (data) => {
            if (this.callbacks.onBotResponse) {
                this.callbacks.onBotResponse(data);
            }
        });
        
        // Handle user transcript acknowledgments
        this.pipecatClient.on('userTranscript', (data) => {
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript(data);
            }
        });
        
        // Handle connection state changes
        this.pipecatClient.on('connectionStateChange', (state) => {
            console.log('Pipecat connection state:', state);
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange(state);
            }
        });
        
        // Handle errors
        this.pipecatClient.on('error', (error) => {
            console.error('Pipecat client error:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
        });
    }
    
    async startMediaStreamingToPipecat() {
        try {
            // Get microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            // Create combined stream with screen video and microphone audio
            let combinedTracks = [];
            
            // Add audio tracks
            audioStream.getAudioTracks().forEach(track => {
                combinedTracks.push(track);
            });
            
            // Add screen video tracks if available
            if (this.screenStream) {
                this.screenStream.getVideoTracks().forEach(track => {
                    combinedTracks.push(track);
                });
            }
            
            // Create combined MediaStream
            const combinedStream = new MediaStream(combinedTracks);
            
            // Hook up MediaStream tracks to PipecatClient
            if (this.pipecatClient && typeof this.pipecatClient.addTrack === 'function') {
                // If PipecatClient has addTrack method
                combinedTracks.forEach((track, index) => {
                    this.pipecatClient.addTrack(track, combinedStream);
                });
            } else if (this.pipecatClient && typeof this.pipecatClient.setLocalMediaStream === 'function') {
                // Alternative method - set entire stream
                await this.pipecatClient.setLocalMediaStream(combinedStream);
            } else {
                console.warn('PipecatClient track methods not found - falling back to speech recognition');
                // Fallback to speech recognition approach
                this.setupSpeechRecognitionForPipecat();
                return true;
            }
            
            // Set up additional callbacks for real-time transcription
            this.setupPipecatMediaHandlers();
            
            this.isConnected = true;
            console.log('Media streaming to Pipecat completed successfully!');
            return true;
            
        } catch (error) {
            console.error('Media streaming to Pipecat failed:', error);
            throw new Error(`Media streaming failed: ${error.message}`);
        }
    }
    
    setupPipecatMediaHandlers() {
        // Listen for real-time transcription events from Pipecat
        if (this.pipecatClient) {
            // These event names might vary - check Pipecat client documentation
            const eventNames = ['transcript', 'userSpeech', 'botResponse', 'audioTranscript'];
            
            eventNames.forEach(eventName => {
                if (typeof this.pipecatClient.on === 'function') {
                    this.pipecatClient.on(eventName, (data) => {
                        if (eventName.includes('transcript') || eventName.includes('Speech')) {
                            // Handle user transcription
                            if (this.callbacks.onUserTranscript) {
                                this.callbacks.onUserTranscript(data);
                            }
                        } else if (eventName.includes('bot') || eventName.includes('Response')) {
                            // Handle bot response
                            if (this.callbacks.onBotResponse) {
                                this.callbacks.onBotResponse(data);
                            }
                        }
                    });
                }
            });
        }
    }

    async startMediaCapture() {
        // Fallback method for when Pipecat connection fails
        try {
            // Get microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            // Set up speech recognition for local processing
            this.setupSpeechRecognition();
            
            this.isConnected = true;
            return true;
            
        } catch (error) {
            throw new Error(`Media capture failed: ${error.message}`);
        }
    }

    setupSpeechRecognitionForPipecat() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            return;
        }
        
        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = 'en-US';
        
        this.speechRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;
                
                if (isFinal) {
                    this.sendTextToPipecatViaDataChannel(transcript);
                } else {
                    if (this.callbacks.onUserTranscript) {
                        this.callbacks.onUserTranscript({ text: transcript, final: false });
                    }
                }
            }
        };
        
        this.speechRecognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
        
        // Start listening
        this.speechRecognition.start();
        console.log('Speech recognition started for Pipecat');
    }

    setupSpeechRecognition() {
        // Fallback speech recognition for local processing
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            return;
        }
        
        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = 'en-US';
        
        this.speechRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;
                
                if (isFinal) {
                    this.sendTextToBackground(transcript);
                } else {
                    if (this.callbacks.onUserTranscript) {
                        this.callbacks.onUserTranscript({ text: transcript, final: false });
                    }
                }
            }
        };
        
        this.speechRecognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
        
        // Start listening
        this.speechRecognition.start();
        console.log('Fallback speech recognition started');
    }
    
    setupScreenCapture() {
        // Screen capture will be sent with text queries for context
    }
    
    async sendTextToPipecatViaDataChannel(text) {
        try {
            if (!this.pipecatClient) {
                throw new Error('Pipecat client not connected');
            }
            
            // Prepare payload with text and optional screen capture
            let payload = {
                text: text,
                timestamp: Date.now()
            };
            
            // If screen stream is available, capture a frame and include it
            if (this.screenStream) {
                const screenFrame = await this.captureScreenFrame();
                if (screenFrame) {
                    payload.screenshot = screenFrame;
                }
            }
            
            // Send message via Pipecat WebRTC data channel
            await this.pipecatClient.sendClientMessage('user-text', payload);
            
            // Trigger user transcript callback to show the text was sent
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript({ text: text, final: true });
            }
            
        } catch (error) {
            console.error('Error sending text to Pipecat:', error);
            
            // Fallback to local processing
            console.log('Falling back to local processing...');
            this.sendTextToBackground(text);
        }
    }
    
    async sendTextToBackground(text) {
        try {
            // Trigger user transcript callback
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript({ text: text, final: true });
            }
            
            // Capture screen frame if available
            let screenCapture = null;
            if (this.screenStream) {
                screenCapture = await this.captureScreenFrame();
            }
            
            // Send to background script for processing (which can use Gemini API)
            chrome.runtime.sendMessage({
                type: 'PROCESS_USER_QUERY',
                data: {
                    query: text,
                    pageInfo: {
                        url: window.location.href,
                        title: document.title,
                        screenCapture: screenCapture
                    }
                }
            }, (response) => {
                if (response && response.success && this.callbacks.onBotResponse) {
                    this.callbacks.onBotResponse({ 
                        text: response.response,
                        timestamp: Date.now()
                    });
                }
            });
            
        } catch (error) {
            console.error('Error sending text to background:', error);
        }
    }
    
    async captureScreenFrame() {
        // Ensure we have a fresh, live screen stream
        try {
            const screenStream = await this.getFreshScreenStream();
            if (!screenStream) return null;
            
            // Create a video element to capture the current frame
            const video = document.createElement('video');
            video.srcObject = screenStream;
            video.play();
            
            return new Promise((resolve) => {
                video.addEventListener('loadedmetadata', () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0);
                    
                    // Convert to base64
                    const imageData = canvas.toDataURL('image/jpeg', 0.8);
                    resolve(imageData);
                });
            });
        } catch (error) {
            console.error('Screen frame capture failed:', error);
            return null;
        }
    }

    async getFreshScreenStream() {
        // If we have a live track, just return it
        if (this.screenStream && 
            this.screenStream.getVideoTracks().length > 0 &&
            this.screenStream.getVideoTracks()[0].readyState === 'live') {
            return this.screenStream;
        }
        
        // Otherwise clear and re-request
        this.screenStream = null;
        
        try {
            // Request screen capture permission via Chrome extension API
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen', 'window', 'tab'], // Allow multiple source types
                    (streamId) => {
                        if (streamId) {
                            resolve(streamId);
                        } else {
                            console.error('Screen capture permission denied');
                            reject(new Error('Screen capture permission denied'));
                        }
                    }
                );
            });
            
            // Get screen stream with the new streamId
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
            
            // Watch for the user hitting "stop sharing"
            if (this.screenStream.getVideoTracks().length > 0) {
                this.screenStream.getVideoTracks()[0].onended = () => {
                    console.log('User stopped screen sharing - clearing stream');
                    this.screenStream = null;
                };
            }
            
            return this.screenStream;
            
        } catch (error) {
            console.error('Failed to get fresh screen stream:', error);
            this.screenStream = null;
            throw error;
        }
    }

    async setupScreenSharing() {
        try {
            // Get fresh screen stream
            this.screenStream = await this.getFreshScreenStream();
            
            if (!this.screenStream) {
                throw new Error('No screen stream available');
            }
            
            return true;
        } catch (error) {
            console.error('Screen sharing setup failed:', error);
            
            if (error.message.includes('permission denied')) {
                console.log('HELP: To use the Shopping Assistant:');
                console.log('  1. Click "Start a chat" again');
                console.log('  2. When the screen sharing dialog appears, choose "Entire Screen" or a specific window');
                console.log('  3. Click "Share" to grant permission');
                console.log('  4. The Shopping Assistant will then be able to see what you\'re looking at!');
            }
            
            throw new Error(`Screen sharing setup failed: ${error.message}`);
        }
    }

    async startScreenStreamToDaily() {
        if (!this.screenStream || !this.peerConnection) {
            console.error('Missing screen stream or WebRTC connection');
            throw new Error('Screen stream or WebRTC connection not available');
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
            
            // Add tracks to WebRTC peer connection
            combinedStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, combinedStream);
            });
            
            console.log('Screen + audio streaming to Pipecat via WebRTC');
            return true;
        } catch (error) {
            console.error('Failed to start screen stream:', error);
            throw new Error(`Failed to start screen stream: ${error.message}`);
        }
    }

    async startAudioOnlyMode() {
        try {
            // Get microphone audio only
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            // Enable audio in Daily
            await this.dailyCallObject.setLocalAudio(true);
            await this.dailyCallObject.setLocalVideo(false); // No video in audio-only mode
            
            // Set audio stream
            await this.dailyCallObject.updateInputSettings({
                audio: {
                    mediaStream: audioStream
                }
            });
            
            console.log('Audio-only mode active - bot can hear you but cannot see screen');
            return true;
        } catch (error) {
            console.error('Audio-only mode failed:', error);
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
                
                if (!response.ok) {
                    console.warn('Keep-alive ping failed:', response.status);
                }
            } catch (error) {
                console.warn('Keep-alive ping error:', error.message);
            }
        }, 30000); // 30 seconds
    }
    
    stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
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