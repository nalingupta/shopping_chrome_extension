import { API_CONFIG } from '../config/api-keys.js';

export class GeminiLiveStreamingService {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isStreaming = false;
        this.isSetupComplete = false;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.screenStream = null;
        this.audioStream = null;
        
        // Debug counters
        this.audioChunksSent = 0;
        this.videoFramesSent = 0;
        
        // Buffer for media chunks until setup is complete
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
        
        // Callbacks
        this.callbacks = {
            onUserTranscript: null,
            onBotResponse: null,
            onConnectionStateChange: null,
            onError: null
        };
    }

    async initialize() {
        try {
            // Initialize audio context for audio processing
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000 // Gemini Live API prefers 16kHz
                });
            }
            
            return { success: true, message: 'Gemini Live API ready' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async startStreaming() {
        if (this.isStreaming) {
            return { success: false, error: 'Already streaming' };
        }
        
        try {
            console.log('Starting Gemini Live streaming...');
            
            // Step 1: Get screen sharing permission
            try {
                await this.setupScreenSharing();
                console.log('Screen sharing ready');
            } catch (screenError) {
                console.error('Screen sharing setup failed:', screenError.message);
                console.log('Continuing without screen sharing - using audio only');
            }
            
            // Step 2: Get microphone permission
            await this.setupAudioCapture();
            console.log('Audio capture ready');
            
            // Step 3: Connect to Gemini Live API
            await this.connectToGeminiLive();
            
            // Step 4: Start streaming media
            await this.startMediaStreaming();
            
            this.isStreaming = true;
            console.log('Streaming started - Gemini can now see your screen and hear you!');
            
            // Don't send text - rely on audio/video only
            
            return { success: true, message: 'Real-time streaming started with Gemini Live API' };
        } catch (error) {
            console.error('Streaming start error:', error);
            return { success: false, error: error.message };
        }
    }

    async connectToGeminiLive() {
        return new Promise((resolve, reject) => {
            try {
                // Reset setup state for new connection
                this.isSetupComplete = false;
                this.pendingAudioChunks = [];
                this.pendingVideoFrames = [];
                
                // Gemini Live API WebSocket endpoint
                const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_CONFIG.GEMINI_API_KEY}`;
                
                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = 'blob';  // Handle binary data as blobs
                
                this.ws.onopen = async () => {
                    console.log('🔗 WEBSOCKET CONNECTED to Gemini Live API');
                    console.log('🔗 WebSocket readyState:', this.ws.readyState, '(OPEN=1)');
                    this.isConnected = true;
                    
                    // Small delay to ensure connection is stable
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Send initial configuration
                    console.log('🔧 Sending initial configuration to Gemini...');
                    this.sendConfiguration();
                    
                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange('connected');
                    }
                    resolve();
                };
                
                this.ws.onmessage = async (event) => {
                    // Handle both text and blob data
                    let data;
                    if (event.data instanceof Blob) {
                        data = await event.data.text();
                    } else {
                        data = event.data;
                    }
                    this.handleGeminiMessage(data);
                };
                
                this.ws.onerror = (error) => {
                    console.error('❌ WEBSOCKET ERROR:', error);
                    console.error('🔗 WebSocket readyState when error occurred:', this.ws ? this.ws.readyState : 'null');
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                    reject(new Error('WebSocket connection failed'));
                };
                
                this.ws.onclose = (event) => {
                    console.log('🔌 WEBSOCKET DISCONNECTED from Gemini Live API');
                    console.log('🔌 Close code:', event.code, 'Reason:', event.reason);
                    console.log('🔌 Was clean shutdown:', event.wasClean);
                    this.isConnected = false;
                    this.isSetupComplete = false;
                    
                    // Clear any buffered chunks on disconnect
                    this.pendingAudioChunks = [];
                    this.pendingVideoFrames = [];
                    console.log('🧹 Cleared buffered chunks on disconnect');
                    
                    // Log close codes for debugging
                    if (event.code === 1006) {
                        console.error('❌ ABNORMAL CLOSURE (1006) - possibly auth issue, network problem, or invalid endpoint');
                    } else if (event.code === 1000) {
                        console.log('✅ NORMAL CLOSURE (1000) - connection closed properly');
                    } else if (event.code === 1001) {
                        console.log('📱 GOING AWAY (1001) - page unload or server going down');
                    } else if (event.code === 1002) {
                        console.error('❌ PROTOCOL ERROR (1002) - WebSocket protocol error');
                    } else if (event.code === 1003) {
                        console.error('❌ UNSUPPORTED DATA (1003) - unsupported data type');
                    }
                    
                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange('disconnected');
                    }
                };
                
            } catch (error) {
                reject(error);
            }
        });
    }

    sendConfiguration() {
        // Send initial configuration using correct Gemini Live API format
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
                    responseModalities: ["TEXT"]  // Text-only responses for now
                }
            }
        };
        
        this.sendMessage(setupMessage);
    }

    async setupScreenSharing() {
        try {
            // Request screen capture permission via Chrome extension API
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen', 'window', 'tab'],
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
                        maxWidth: 1920,
                        maxHeight: 1080,
                        maxFrameRate: 30
                    }
                }
            });
            
            // Watch for the user hitting "stop sharing"
            if (this.screenStream.getVideoTracks().length > 0) {
                this.screenStream.getVideoTracks()[0].onended = () => {
                    console.log('User stopped screen sharing');
                    this.screenStream = null;
                };
            }
            
            return true;
        } catch (error) {
            console.error('Screen sharing setup failed:', error);
            throw error;
        }
    }

    async setupAudioCapture() {
        try {
            // Ensure audio context is ready
            if (!this.audioContext) {
                await this.initialize();
            }
            
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Get microphone audio
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });
            
            return true;
        } catch (error) {
            console.error('Audio capture setup failed:', error);
            throw error;
        }
    }

    async startMediaStreaming() {
        // Wait for setup to complete
        let waitCount = 0;
        while (!this.isSetupComplete && waitCount < 50) { // Wait up to 5 seconds
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
        }
        
        if (!this.isSetupComplete) {
            throw new Error('Setup did not complete in time');
        }
        
        // Stream video frames periodically
        if (this.screenStream) {
            this.startVideoStreaming();
        }
        
        // Stream audio continuously
        if (this.audioStream) {
            this.startAudioStreaming();
        }
    }

    startVideoStreaming() {
        console.log('Starting video streaming...');
        const video = document.createElement('video');
        video.srcObject = this.screenStream;
        
        // Wait for video to be ready
        video.onloadedmetadata = () => {
            console.log('Video metadata loaded, dimensions:', video.videoWidth, 'x', video.videoHeight);
            video.play();
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Send video frames at 2 FPS (every 500ms)
            this.videoInterval = setInterval(() => {
                if (!this.isConnected || !this.screenStream || !this.isSetupComplete) {
                    console.log('Skipping frame - not ready');
                    return;
                }
                
                try {
                    // Set canvas size to match video
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    
                    // Draw current frame
                    ctx.drawImage(video, 0, 0);
                    
                    // Convert to base64 JPEG
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const base64 = reader.result.split(',')[1];
                                this.sendVideoFrame(base64);
                            };
                            reader.readAsDataURL(blob);
                        } else {
                            console.error('Failed to create blob from canvas');
                        }
                    }, 'image/jpeg', 0.8);
                    
                } catch (error) {
                    console.error('Video frame capture error:', error);
                }
            }, 500); // 2 FPS
        };
        
        video.onerror = (error) => {
            console.error('Video element error:', error);
        };
    }

    startAudioStreaming() {
        // Ensure audio context is initialized
        if (!this.audioContext || !this.audioStream) {
            console.error('Audio context or stream not initialized');
            return;
        }
        
        console.log('Starting audio streaming with direct PCM conversion...');
        
        // Use direct AudioContext processing for real-time PCM conversion
        this.startDirectPCMStreaming();
    }
    
    async startDirectPCMStreaming() {
        try {
            console.log('🎤 Setting up direct PCM streaming...');
            console.log('🎤 Audio context state:', this.audioContext.state);
            console.log('🎤 Audio stream tracks:', this.audioStream.getTracks().length);
            
            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                console.log('🎤 Resuming suspended audio context...');
                await this.audioContext.resume();
                console.log('🎤 Audio context resumed');
            }
            
            // Try to use AudioWorkletNode (modern approach)
            if (this.audioContext.audioWorklet) {
                await this.startAudioWorkletProcessing();
            } else {
                console.warn('🎤 AudioWorklet not supported, falling back to ScriptProcessorNode');
                this.startScriptProcessorFallback();
            }
            
        } catch (error) {
            console.error('❌ Direct PCM streaming failed:', error);
            // Fallback to ScriptProcessorNode
            console.log('🎤 Falling back to ScriptProcessorNode due to error');
            this.startScriptProcessorFallback();
        }
    }
    
    async startAudioWorkletProcessing() {
        try {
            console.log('🎤 Using modern AudioWorkletNode...');
            
            // Create the AudioWorklet processor inline
            const processorCode = `
                class PCMProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.processEventCount = 0;
                    }
                    
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        const output = outputs[0];
                        
                        if (input.length > 0) {
                            const inputChannel = input[0];
                            const outputChannel = output[0];
                            
                            this.processEventCount++;
                            
                            // Check for audio activity
                            let hasSpeech = false;
                            let maxAmplitude = 0;
                            
                            for (let i = 0; i < inputChannel.length; i++) {
                                const amplitude = Math.abs(inputChannel[i]);
                                maxAmplitude = Math.max(maxAmplitude, amplitude);
                                if (amplitude > 0.02) { // Higher threshold for actual speech
                                    hasSpeech = true;
                                }
                                // Copy input to output
                                outputChannel[i] = inputChannel[i];
                            }
                            
                            // ALWAYS send audio data to main thread for continuous processing
                            // Convert float32 to int16 PCM
                            const pcmData = new Int16Array(inputChannel.length);
                            for (let i = 0; i < inputChannel.length; i++) {
                                const sample = Math.max(-1, Math.min(1, inputChannel[i]));
                                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                            }
                            
                            this.port.postMessage({
                                type: 'audioData',
                                pcmData: pcmData,
                                maxAmplitude: maxAmplitude,
                                hasSpeech: hasSpeech,
                                eventCount: this.processEventCount
                            });
                        }
                        
                        return true; // Keep processing
                    }
                }
                
                registerProcessor('pcm-processor', PCMProcessor);
            `;
            
            // Create blob URL for the processor
            const blob = new Blob([processorCode], { type: 'application/javascript' });
            const processorUrl = URL.createObjectURL(blob);
            
            // Add the AudioWorklet module
            await this.audioContext.audioWorklet.addModule(processorUrl);
            console.log('🎤 AudioWorklet module loaded');
            
            // Create the AudioWorkletNode
            const workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');
            console.log('🎤 Created AudioWorkletNode');
            
            // Handle messages from the worklet
            let lastLogTime = 0;
            workletNode.port.onmessage = (event) => {
                const { type, pcmData, maxAmplitude, eventCount, hasSpeech } = event.data;
                
                if (type === 'audioData') {
                    // Show continuous audio processing heartbeat
                    const now = Date.now();
                    if (now - lastLogTime > 2000) { // Every 2 seconds
                        console.log(`🎤 Listening... (event #${eventCount}, amp: ${maxAmplitude.toFixed(3)})`);
                        lastLogTime = now;
                    }
                    
                    // Only send to Gemini when there's actual speech
                    if (hasSpeech && this.isConnected && this.isSetupComplete) {
                        // Convert to base64 and send
                        const uint8Array = new Uint8Array(pcmData.buffer);
                        const base64 = btoa(String.fromCharCode(...uint8Array));
                        
                        this.audioChunksSent++;
                        console.log(`🎤 SPEECH #${this.audioChunksSent} (amp: ${maxAmplitude.toFixed(3)}) → GEMINI`);
                        this.sendAudioChunk(base64);
                    }
                }
            };
            
            // Create audio source and connect
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            source.connect(workletNode);
            workletNode.connect(this.audioContext.destination);
            
            // Store references
            this.audioWorkletNode = workletNode;
            this.audioSource = source;
            this.processorUrl = processorUrl;
            
            console.log('✅ AudioWorklet PCM streaming started successfully');
            console.log('🎤 Audio processing chain: MediaStream → Source → AudioWorkletNode → Destination');
            
        } catch (error) {
            console.error('❌ AudioWorklet setup failed:', error);
            throw error;
        }
    }
    
    startScriptProcessorFallback() {
        try {
            console.log('🎤 Using legacy ScriptProcessorNode fallback...');
            
            // Create audio processing chain
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            console.log('🎤 Created MediaStreamSource');
            
            // Create ScriptProcessorNode for real-time processing
            const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            console.log('🎤 Created ScriptProcessorNode with 4096 buffer size');
            
            let processEventCount = 0;
            let lastLogTime = 0;
            processor.onaudioprocess = (event) => {
                processEventCount++;
                
                const inputData = event.inputBuffer.getChannelData(0);
                const outputData = event.outputBuffer.getChannelData(0);
                
                // Always copy input to output to keep chain active
                for (let i = 0; i < inputData.length; i++) {
                    outputData[i] = inputData[i];
                }
                
                // Check for speech activity
                let hasSpeech = false;
                let maxAmplitude = 0;
                for (let i = 0; i < inputData.length; i++) {
                    const amplitude = Math.abs(inputData[i]);
                    maxAmplitude = Math.max(maxAmplitude, amplitude);
                    if (amplitude > 0.02) { // Higher threshold for actual speech
                        hasSpeech = true;
                    }
                }
                
                // Show continuous audio processing heartbeat
                const now = Date.now();
                if (now - lastLogTime > 2000) { // Every 2 seconds
                    console.log(`🎤 Listening... (event #${processEventCount}, amp: ${maxAmplitude.toFixed(3)})`);
                    lastLogTime = now;
                }
                
                // Only send to Gemini when there's actual speech
                if (hasSpeech && this.isConnected && this.isSetupComplete) {
                    // Convert float32 to int16 PCM
                    const pcmData = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                        const sample = Math.max(-1, Math.min(1, inputData[i]));
                        pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                    }
                    
                    // Convert to base64 and send
                    const uint8Array = new Uint8Array(pcmData.buffer);
                    const base64 = btoa(String.fromCharCode(...uint8Array));
                    
                    this.audioChunksSent++;
                    console.log(`🎤 SPEECH #${this.audioChunksSent} (amp: ${maxAmplitude.toFixed(3)}) → GEMINI`);
                    this.sendAudioChunk(base64);
                }
            };
            
            // Connect the processing chain
            source.connect(processor);
            processor.connect(this.audioContext.destination);
            
            // Store references
            this.audioProcessor = processor;
            this.audioSource = source;
            
            console.log('✅ ScriptProcessorNode PCM streaming started successfully');
            console.log('🎤 Audio processing chain: MediaStream → Source → Processor → Destination');
            
        } catch (error) {
            console.error('❌ ScriptProcessorNode fallback failed:', error);
        }
    }
    
    startAudioStreamingWithAudioContext() {
        // Fallback method using AudioContext
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        
        // Use AnalyserNode for better audio processing
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 2048;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        source.connect(analyser);
        
        // Process audio in intervals
        this.audioProcessingInterval = setInterval(() => {
            if (!this.isConnected || !this.isSetupComplete) {
                return;
            }
            
            analyser.getByteFrequencyData(dataArray);
            
            // Check if there's actual audio activity
            let hasAudio = false;
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
                if (dataArray[i] > 30) { // Threshold for detecting audio
                    hasAudio = true;
                }
            }
            
            if (!hasAudio) return; // Skip silent frames
            
            // Convert frequency data to a simple format and send
            const audioLevel = sum / bufferLength;
            const base64Audio = btoa(String.fromCharCode(...dataArray));
            this.sendAudioChunk(base64Audio);
            
        }, 100); // Process every 100ms
    }
    
    async convertWebMAudioToPCM(audioBlob) {
        try {
            // Create an audio context for conversion
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000 // Target sample rate for Gemini
            });
            
            // Convert blob to array buffer
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            // Decode audio data
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Get the raw audio data (should be mono)
            const channelData = audioBuffer.getChannelData(0);
            
            // Convert float32 to int16 PCM
            const pcmData = new Int16Array(channelData.length);
            for (let i = 0; i < channelData.length; i++) {
                // Clamp to [-1, 1] range and convert to 16-bit int
                const sample = Math.max(-1, Math.min(1, channelData[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
            
            // Convert to base64
            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            
            // Close the temporary audio context
            await audioContext.close();
            
            return base64;
            
        } catch (error) {
            console.error('PCM conversion error:', error);
            return null;
        }
    }

    sendVideoFrame(base64Data) {
        // Buffer frames until setup is complete and WebSocket is open
        if (!this.isSetupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('📦 BUFFERING video frame until setup complete');
            this.pendingVideoFrames.push(base64Data);
            return;
        }
        
        this.videoFramesSent++;
        console.log(`📹 VIDEO #${this.videoFramesSent}`);
        
        // For video, we might need to use a different structure or mediaChunks
        // For now, let's try the mediaChunks format for images
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

    sendAudioChunk(base64Data) {
        // Buffer chunks until setup is complete and WebSocket is open
        if (!this.isSetupComplete || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('📦 BUFFERING audio chunk until setup complete');
            this.pendingAudioChunks.push(base64Data);
            return;
        }
        
        // Logging handled in the calling methods
        
        // Use correct Gemini Live API format from official docs
        const message = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: "audio/pcm;rate=16000"  // Correct format from docs
                }
            }
        };
        this.sendMessage(message);
    }

    processBufferedChunks() {
        console.log(`🚀 PROCESSING BUFFERED CHUNKS: ${this.pendingAudioChunks.length} audio, ${this.pendingVideoFrames.length} video`);
        
        // Process buffered audio chunks
        const audioChunks = [...this.pendingAudioChunks];
        this.pendingAudioChunks = []; // Clear the buffer
        
        audioChunks.forEach((base64Data, index) => {
            console.log(`📤 Sending buffered audio chunk ${index + 1}/${audioChunks.length}`);
            this.sendAudioChunk(base64Data);
        });
        
        // Process buffered video frames
        const videoFrames = [...this.pendingVideoFrames];
        this.pendingVideoFrames = []; // Clear the buffer
        
        videoFrames.forEach((base64Data, index) => {
            console.log(`📤 Sending buffered video frame ${index + 1}/${videoFrames.length}`);
            this.sendVideoFrame(base64Data);
        });
        
        if (audioChunks.length > 0 || videoFrames.length > 0) {
            console.log('✅ All buffered chunks sent successfully');
        }
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // Log all outgoing messages with detailed info
            // Simplified logging - detailed logs handled in individual methods
            if (!message.realtimeInput) {
                console.log('📤 SENDING TO GEMINI: Control message:', JSON.stringify(message, null, 2));
            }
            
            try {
                this.ws.send(JSON.stringify(message));
                // Removed success logging to reduce noise
            } catch (error) {
                console.error('❌ Failed to send message:', error);
            }
        } else {
            console.error('❌ WebSocket not open! ReadyState:', this.ws ? this.ws.readyState : 'null', 'Cannot send message');
            if (this.ws) {
                console.log('WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
            }
        }
    }

    handleGeminiMessage(data) {
        // Log ALL incoming data first
        console.log('📥 RECEIVED FROM GEMINI: Raw data length:', data.length);
        
        try {
            const message = JSON.parse(data);
            console.log('📥 RECEIVED FROM GEMINI: Parsed message type:', Object.keys(message).join(', '));
            console.log('📥 RECEIVED FROM GEMINI: Full message:', JSON.stringify(message, null, 2));
            
            // Handle setup completion (BidiGenerateContentSetupComplete)
            if (message.setupComplete !== undefined || message.setup_complete !== undefined) {
                console.log('🟢 GEMINI SETUP COMPLETE:', message);
                this.isSetupComplete = true;
                
                // Process any buffered media chunks now that setup is complete
                this.processBufferedChunks();
                return;
            }
            
            // Handle server content (bot responses) - match JavaScript SDK format
            if (message.serverContent) {
                console.log('🤖 PROCESSING BOT RESPONSE from serverContent...');
                
                // Check for turn completion (matches JavaScript SDK pattern)
                if (message.serverContent.turnComplete) {
                    console.log('✅ Turn complete received');
                }
                
                // Process model turn content
                if (message.serverContent.modelTurn && message.serverContent.modelTurn.parts) {
                    console.log('📝 Found modelTurn with parts, processing...');
                    message.serverContent.modelTurn.parts.forEach((part, index) => {
                        console.log(`📝 Processing part ${index}:`, part);
                        if (part.text) {
                            console.log('✅ GEMINI BOT RESPONSE TEXT:', part.text);
                            // Bot text response
                            if (this.callbacks.onBotResponse) {
                                console.log('🔄 Calling onBotResponse callback...');
                                this.callbacks.onBotResponse({
                                    text: part.text,
                                    timestamp: Date.now()
                                });
                                console.log('✅ onBotResponse callback called successfully');
                            } else {
                                console.error('❌ No onBotResponse callback set!');
                            }
                        } else if (part.inlineData) {
                            if (part.inlineData.mimeType && part.inlineData.mimeType.includes('audio')) {
                                console.log('🔊 GEMINI AUDIO RESPONSE received');
                                // TODO: Handle audio playback
                            }
                        } else {
                            console.log('❓ Unknown part type:', part);
                        }
                    });
                } else {
                    console.log('❌ No modelTurn.parts found in serverContent');
                    console.log('🔍 Full serverContent:', JSON.stringify(message.serverContent, null, 2));
                }
            }
            
            // Also handle if using direct message.data format (for audio responses)
            if (message.data) {
                console.log('🔊 GEMINI AUDIO DATA received, length:', message.data.length);
                // This would be base64 audio data like in the JavaScript example
            }
            
            // Handle tool calls
            if (message.toolCall) {
                console.log('🔧 Tool call received:', message.toolCall);
            }
            
            // Handle errors
            if (message.error) {
                console.error('❌ GEMINI API ERROR:', message.error);
                if (this.callbacks.onError) {
                    this.callbacks.onError(message.error);
                }
            }
            
            // Log if message doesn't match any known pattern
            const knownKeys = ['setupComplete', 'setup_complete', 'serverContent', 'server_content', 'candidates', 'toolCall', 'error'];
            const messageKeys = Object.keys(message);
            const unknownKeys = messageKeys.filter(key => !knownKeys.includes(key));
            if (unknownKeys.length > 0) {
                console.log('❓ Unknown message keys detected:', unknownKeys);
            }
            
        } catch (error) {
            console.error('❌ Error parsing Gemini message:', error);
            console.error('🔍 Raw data that failed to parse:', data);
        }
    }

    async stopStreaming() {
        if (!this.isStreaming) {
            return { success: false, error: 'Not currently streaming' };
        }
        
        try {
            // Stop video streaming
            if (this.videoInterval) {
                clearInterval(this.videoInterval);
                this.videoInterval = null;
            }
            
            // Stop audio processing
            if (this.audioProcessingInterval) {
                clearInterval(this.audioProcessingInterval);
                this.audioProcessingInterval = null;
            }
            
            // Stop audio processing
            if (this.audioWorkletNode) {
                this.audioWorkletNode.disconnect();
                this.audioWorkletNode = null;
            }
            
            if (this.audioProcessor) {
                this.audioProcessor.disconnect();
                this.audioProcessor = null;
            }
            
            if (this.audioSource) {
                this.audioSource.disconnect();
                this.audioSource = null;
            }
            
            // Clean up processor URL
            if (this.processorUrl) {
                URL.revokeObjectURL(this.processorUrl);
                this.processorUrl = null;
            }
            
            // Stop audio recorder if it exists (legacy)
            if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
                this.audioRecorder.stop();
                this.audioRecorder = null;
            }
            
            // Stop screen stream
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
                this.screenStream = null;
            }
            
            // Stop audio stream
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
                this.audioStream = null;
            }
            
            // Close WebSocket connection
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            
            // Don't close audio context - keep it for next session
            // Just suspend it to save resources
            if (this.audioContext && this.audioContext.state === 'running') {
                await this.audioContext.suspend();
            }
            
            this.isStreaming = false;
            this.isConnected = false;
            this.isSetupComplete = false;
            
            // Clear any buffered chunks
            this.pendingAudioChunks = [];
            this.pendingVideoFrames = [];
            console.log('🧹 Cleared buffered chunks on stop');
            
            return { success: true, message: 'Streaming stopped' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Callback setters
    setUserTranscriptCallback(callback) {
        this.callbacks.onUserTranscript = callback;
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

    // Send text message to Gemini
    sendTextMessage(text) {
        if (!this.isSetupComplete) {
            console.error('Cannot send text - setup not complete');
            return;
        }
        
        const message = {
            client_content: {
                turn_complete: true,
                turns: [{
                    role: "user",
                    parts: [{
                        text: text
                    }]
                }]
            }
        };
        
        console.log('Sending text to Gemini:', text);
        this.sendMessage(message);
    }
    
    // Send end of turn signal
    sendEndOfTurn() {
        if (!this.isSetupComplete) return;
        
        const message = {
            client_content: {
                turn_complete: true
            }
        };
        
        console.log('Sending end of turn signal');
        this.sendMessage(message);
    }
    
    // Status methods
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isStreaming: this.isStreaming,
            hasScreenStream: !!this.screenStream,
            hasAudioStream: !!this.audioStream
        };
    }

    cleanup() {
        if (this.videoInterval) {
            clearInterval(this.videoInterval);
            this.videoInterval = null;
        }
        
        // Clean up audio processing
        if (this.audioWorkletNode) {
            try {
                this.audioWorkletNode.disconnect();
            } catch (error) {
                console.error('Error disconnecting AudioWorkletNode:', error);
            }
            this.audioWorkletNode = null;
        }
        
        if (this.audioProcessor) {
            try {
                this.audioProcessor.disconnect();
            } catch (error) {
                console.error('Error disconnecting audio processor:', error);
            }
            this.audioProcessor = null;
        }
        
        if (this.audioSource) {
            try {
                this.audioSource.disconnect();
            } catch (error) {
                console.error('Error disconnecting audio source:', error);
            }
            this.audioSource = null;
        }
        
        // Clean up processor URL
        if (this.processorUrl) {
            try {
                URL.revokeObjectURL(this.processorUrl);
            } catch (error) {
                console.error('Error revoking processor URL:', error);
            }
            this.processorUrl = null;
        }
        
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.isConnected = false;
        this.isStreaming = false;
        this.isSetupComplete = false;
        
        // Clear any buffered chunks
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
    }
}