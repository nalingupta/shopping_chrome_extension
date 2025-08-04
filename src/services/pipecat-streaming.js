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
            
            // Step 3: Connect to the Daily room that Pipecat created
            console.log('📞 Step 3: Connecting to Daily room for real-time streaming...');
            try {
                await this.connectAndStreamToDaily(sessionResponse.roomUrl, sessionResponse.dailyToken);
                console.log('✅ Step 3 SUCCESS: Connected to Daily room and streaming');
            } catch (streamError) {
                console.error('💥 Step 3 FAILED:', streamError.message);
                console.log('⚠️ FALLING BACK TO LOCAL SPEECH RECOGNITION');
                // Fallback to local processing
                await this.startMediaCapture();
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

    async connectAndStreamToDaily(roomUrl, dailyToken) {
        try {
            console.log('🔗 Connecting to Pipecat via WebRTC data channel...');
            console.log('📍 Room URL:', roomUrl);
            console.log('🎫 Daily Token:', dailyToken ? 'Present' : 'Missing');
            
            // Initialize Pipecat JavaScript client
            if (typeof window.PipecatClient === 'undefined') {
                throw new Error('Pipecat JavaScript client not loaded - check CDN script tag');
            }
            
            // Create Pipecat client instance
            console.log('🎯 Creating PipecatClient with roomUrl:', roomUrl);
            this.pipecatClient = new window.PipecatClient({
                roomUrl: roomUrl,
                token: dailyToken
            });
            
            // Set up Pipecat client event handlers
            this.setupPipecatClientHandlers();
            
            // Connect to the Pipecat session
            console.log('🚀 Joining Pipecat session...');
            await this.pipecatClient.join();
            
            console.log('✅ Connected to Pipecat via WebRTC data channel');
            
            // Now start media capture and streaming
            await this.startMediaStreamingToPipecat();
            
        } catch (error) {
            console.error('❌ Pipecat connection failed:', error);
            throw new Error(`Pipecat connection failed: ${error.message}`);
        }
    }

    setupPipecatClientHandlers() {
        if (!this.pipecatClient) return;
        
        console.log('📡 Setting up Pipecat client event handlers...');
        
        // Handle bot responses
        this.pipecatClient.on('botResponse', (data) => {
            console.log('🤖 Bot response received:', data);
            if (this.callbacks.onBotResponse) {
                this.callbacks.onBotResponse(data);
            }
        });
        
        // Handle user transcript acknowledgments
        this.pipecatClient.on('userTranscript', (data) => {
            console.log('🎯 User transcript acknowledged:', data);
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript(data);
            }
        });
        
        // Handle connection state changes
        this.pipecatClient.on('connectionStateChange', (state) => {
            console.log('🔄 Pipecat connection state:', state);
            if (this.callbacks.onConnectionStateChange) {
                this.callbacks.onConnectionStateChange(state);
            }
        });
        
        // Handle errors
        this.pipecatClient.on('error', (error) => {
            console.error('❌ Pipecat client error:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
        });
        
        console.log('✅ Pipecat client event handlers set up');
    }
    
    async startMediaStreamingToPipecat() {
        try {
            console.log('🎤 Starting media streaming to Pipecat...');
            
            // Get microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            console.log('🎵 Audio stream obtained');
            
            // Create combined stream with screen video and microphone audio
            let combinedTracks = [];
            
            // Add audio tracks
            audioStream.getAudioTracks().forEach(track => {
                combinedTracks.push(track);
                console.log('🎵 Added audio track to combined stream');
            });
            
            // Add screen video tracks if available
            if (this.screenStream) {
                this.screenStream.getVideoTracks().forEach(track => {
                    combinedTracks.push(track);
                    console.log('📹 Added video track to combined stream');
                });
            }
            
            // Create combined MediaStream
            const combinedStream = new MediaStream(combinedTracks);
            console.log('🔗 Combined stream created with', combinedTracks.length, 'tracks');
            
            // Hook up MediaStream tracks to PipecatClient (as per ChatGPT suggestion)
            console.log('📡 Connecting MediaStream tracks to PipecatClient...');
            if (this.pipecatClient && typeof this.pipecatClient.addTrack === 'function') {
                // If PipecatClient has addTrack method
                combinedTracks.forEach((track, index) => {
                    this.pipecatClient.addTrack(track, combinedStream);
                    console.log(`✅ Added ${track.kind} track ${index + 1} to PipecatClient`);
                });
            } else if (this.pipecatClient && typeof this.pipecatClient.setLocalMediaStream === 'function') {
                // Alternative method - set entire stream
                await this.pipecatClient.setLocalMediaStream(combinedStream);
                console.log('✅ Set combined MediaStream on PipecatClient');
            } else {
                console.warn('⚠️ PipecatClient track methods not found - falling back to speech recognition');
                // Fallback to speech recognition approach
                this.setupSpeechRecognitionForPipecat();
                return true;
            }
            
            // Set up additional callbacks for real-time transcription
            this.setupPipecatMediaHandlers();
            
            this.isConnected = true;
            console.log('🎉 Media streaming to Pipecat completed successfully!');
            return true;
            
        } catch (error) {
            console.error('❌ Media streaming to Pipecat failed:', error);
            throw new Error(`Media streaming failed: ${error.message}`);
        }
    }
    
    setupPipecatMediaHandlers() {
        console.log('🎧 Setting up Pipecat media handlers for real-time transcription...');
        
        // Listen for real-time transcription events from Pipecat
        if (this.pipecatClient) {
            // These event names might vary - check Pipecat client documentation
            const eventNames = ['transcript', 'userSpeech', 'botResponse', 'audioTranscript'];
            
            eventNames.forEach(eventName => {
                if (typeof this.pipecatClient.on === 'function') {
                    this.pipecatClient.on(eventName, (data) => {
                        console.log(`🎯 Received ${eventName} from Pipecat:`, data);
                        
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
        
        console.log('✅ Pipecat media handlers set up');
    }

    async startMediaCapture() {
        // Fallback method for when Pipecat connection fails
        try {
            console.log('🎤 Starting fallback media capture...');
            
            // Get microphone audio
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            console.log('🎵 Audio stream obtained for fallback processing');
            
            // Set up speech recognition for local processing
            this.setupSpeechRecognition();
            
            this.isConnected = true;
            return true;
            
        } catch (error) {
            throw new Error(`Media capture failed: ${error.message}`);
        }
    }

    setupSpeechRecognitionForPipecat() {
        console.log('🗣️ Setting up speech recognition for Pipecat WebRTC communication...');
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('⚠️ Speech recognition not supported');
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
                    console.log('🎯 Final transcript for Pipecat:', transcript);
                    this.sendTextToPipecatViaDataChannel(transcript);
                } else {
                    console.log('💭 Interim transcript:', transcript);
                    if (this.callbacks.onUserTranscript) {
                        this.callbacks.onUserTranscript({ text: transcript, final: false });
                    }
                }
            }
        };
        
        this.speechRecognition.onerror = (event) => {
            console.error('🚨 Speech recognition error:', event.error);
        };
        
        // Start listening
        this.speechRecognition.start();
        console.log('✅ Speech recognition started for Pipecat');
    }

    setupSpeechRecognition() {
        // Fallback speech recognition for local processing
        console.log('🗣️ Setting up fallback speech recognition...');
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('⚠️ Speech recognition not supported');
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
                    console.log('🎯 Final transcript for local processing:', transcript);
                    this.sendTextToBackground(transcript);
                } else {
                    console.log('💭 Interim transcript:', transcript);
                    if (this.callbacks.onUserTranscript) {
                        this.callbacks.onUserTranscript({ text: transcript, final: false });
                    }
                }
            }
        };
        
        this.speechRecognition.onerror = (event) => {
            console.error('🚨 Speech recognition error:', event.error);
        };
        
        // Start listening
        this.speechRecognition.start();
        console.log('✅ Fallback speech recognition started');
    }
    
    setupScreenCapture() {
        console.log('📸 Setting up screen capture for context...');
        // Screen capture will be sent with text queries for context
    }
    
    async sendTextToPipecatViaDataChannel(text) {
        try {
            console.log('📤 Sending text to Pipecat via WebRTC data channel:', text);
            
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
                    console.log('📸 Including screen capture with text');
                }
            }
            
            // Send message via Pipecat WebRTC data channel
            console.log('📡 Sending via Pipecat client data channel...');
            await this.pipecatClient.sendClientMessage('user-text', payload);
            
            console.log('✅ Message sent to Pipecat via WebRTC data channel');
            
            // Trigger user transcript callback to show the text was sent
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript({ text: text, final: true });
            }
            
        } catch (error) {
            console.error('❌ Error sending text to Pipecat:', error);
            
            // Fallback to local processing
            console.log('⚠️ Falling back to local processing...');
            this.sendTextToBackground(text);
        }
    }
    
    async sendTextToBackground(text) {
        try {
            console.log('📤 Sending text to background script for local processing:', text);
            
            // Trigger user transcript callback
            if (this.callbacks.onUserTranscript) {
                this.callbacks.onUserTranscript({ text: text, final: true });
            }
            
            // Capture screen frame if available
            let screenCapture = null;
            if (this.screenStream) {
                screenCapture = await this.captureScreenFrame();
                if (screenCapture) {
                    console.log('📸 Including screen capture with background message');
                }
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
            
            console.log('✅ Text sent to background script with screen capture');
            
        } catch (error) {
            console.error('❌ Error sending text to background:', error);
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
            console.error('❌ Screen frame capture failed:', error);
            return null;
        }
    }

    async getFreshScreenStream() {
        // If we have a live track, just return it (ChatGPT's suggestion)
        if (this.screenStream && 
            this.screenStream.getVideoTracks().length > 0 &&
            this.screenStream.getVideoTracks()[0].readyState === 'live') {
            console.log('♻️ Reusing existing live screen stream');
            return this.screenStream;
        }
        
        // Otherwise clear and re-request
        console.log('🆕 Requesting fresh screen stream...');
        this.screenStream = null;
        
        try {
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
                            console.error('❌ Screen capture permission denied');
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
            
            // Watch for the user hitting "stop sharing" (ChatGPT's suggestion)
            if (this.screenStream.getVideoTracks().length > 0) {
                this.screenStream.getVideoTracks()[0].onended = () => {
                    console.log('👤 User stopped screen sharing - clearing stream');
                    this.screenStream = null;
                };
            }
            
            console.log('✅ Fresh screen stream obtained');
            return this.screenStream;
            
        } catch (error) {
            console.error('❌ Failed to get fresh screen stream:', error);
            this.screenStream = null;
            throw error;
        }
    }

    async setupScreenSharing() {
        try {
            console.log('🖥️ Setting up screen sharing...');
            
            // Get fresh screen stream (following ChatGPT's suggestion)
            this.screenStream = await this.getFreshScreenStream();
            
            if (!this.screenStream) {
                throw new Error('No screen stream available');
            }
            
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
        if (!this.screenStream || !this.peerConnection) {
            console.error('❌ Missing screen stream or WebRTC connection');
            throw new Error('Screen stream or WebRTC connection not available');
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
            
            // Add tracks to WebRTC peer connection
            console.log('📡 Adding stream tracks to WebRTC connection...');
            combinedStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, combinedStream);
                console.log(`✅ Added ${track.kind} track to WebRTC`);
            });
            
            console.log('✅ Screen + audio streaming to Pipecat via WebRTC');
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