import { GeminiLiveAPI } from './gemini-api.js';
import { ScreenCapture } from './screen-capture.js';

export class AudioHandler {
    constructor() {
        this.state = {
            isListening: false,
            isProcessingResponse: false
        };
        
        this.callbacks = {
            transcription: null,
            interim: null,
            botResponse: null,
            status: null
        };
        
        // Gemini-first speech segmentation
        this.speechBuffer = {
            interimText: '',
            lastWebSpeechUpdate: 0,
            isGeminiProcessing: false
        };
        
        this.geminiAPI = new GeminiLiveAPI();
        this.screenCapture = new ScreenCapture();
        this.speechRecognition = null;
        this.audioStream = null;
        this.audioWorkletNode = null;
        this.audioSource = null;
        this.inactivityTimer = null;
        this.speechKeepAliveTimer = null;
        this.lastSpeechActivity = null;
        this.videoStreamingStarted = false;
        this.screenshotInterval = null;
        this.audioStreamingStarted = false;
        
        this.setupGeminiCallbacks();
        this.initializeGemini();
    }

    async initializeGemini() {
        try {
            const result = await this.geminiAPI.initialize();
            if (!result.success) {
                console.error('Gemini initialization failed:', result.error);
            }
        } catch (error) {
            console.error('Error initializing Gemini:', error);
        }
    }

    setupGeminiCallbacks() {
        this.geminiAPI.setBotResponseCallback((data) => {
            this.handleGeminiResponse(data);
        });
        
        this.geminiAPI.setConnectionStateCallback((state) => {
            if (this.callbacks.status) {
                if (state === 'connected') {
                    this.callbacks.status('Connected to Gemini', 'success', 2000);
                } else if (state === 'disconnected') {
                    this.callbacks.status('Disconnected', 'error', 3000);
                }
            }
        });
        
        this.geminiAPI.setErrorCallback((error) => {
            console.error('Gemini error:', error);
            if (this.callbacks.status) {
                this.callbacks.status('Connection error', 'error', 3000);
            }
        });
    }

    handleGeminiResponse(data) {
        if (data.text) {
            // Gemini has processed a complete utterance - stop audio and video streaming
            this.speechBuffer.isGeminiProcessing = false;
            this.stopScreenshotStreaming();
            this.stopAudioStreaming();
            
            // Reset streaming flags for next speech detection
            this.audioStreamingStarted = false;
            this.videoStreamingStarted = false;
            
            // Create final user message from current interim text
            if (this.speechBuffer.interimText.trim() && this.callbacks.transcription) {
                this.callbacks.transcription(this.speechBuffer.interimText.trim());
            }
            
            // Clear interim text since Gemini has processed it
            this.speechBuffer.interimText = '';
            
            // Send bot response
            if (this.callbacks.botResponse) {
                this.callbacks.botResponse(data);
            }
        }
    }

    // Fallback method to handle orphaned interim text
    checkForOrphanedSpeech() {
        const now = Date.now();
        const timeSinceLastUpdate = now - this.speechBuffer.lastWebSpeechUpdate;
        
        // If we have interim text that hasn't been processed by Gemini for 3 seconds, create a message
        if (this.speechBuffer.interimText.trim() && 
            !this.speechBuffer.isGeminiProcessing && 
            timeSinceLastUpdate > 3000) {
            
            console.log('Processing orphaned speech:', this.speechBuffer.interimText);
            
            if (this.callbacks.transcription) {
                this.callbacks.transcription(this.speechBuffer.interimText.trim());
            }
            
            this.speechBuffer.interimText = '';
        }
    }

    async startListening() {
        if (this.state.isListening) {
            return { success: false, error: 'Already listening' };
        }

        try {
            this.resetInactivityTimer();
            
            // Connect to Gemini
            const result = await this.geminiAPI.connect();
            if (!result.success) {
                throw new Error(result.error || 'Failed to connect to Gemini');
            }

            // Setup screen capture
            try {
                console.log('Setting up screen capture...');
                await this.screenCapture.setup();
            } catch (error) {
                console.log('Screen capture setup failed:', error.message, '- continuing with audio only');
            }

            // Setup audio capture
            await this.setupAudioCapture();
            
            // Start media streaming
            await this.startMediaStreaming();
            
            // Start local speech recognition for UI feedback
            this.startLocalSpeechRecognition();
            this.startSpeechKeepAlive();
            
            this.state.isListening = true;
            return { success: true };
            
        } catch (error) {
            console.error('Error starting listening:', error);
            return { success: false, error: error.message };
        }
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: 'Not currently listening' };
        }

        try {
            this.state.isListening = false;
            
            // Process any remaining interim text before stopping
            if (this.speechBuffer.interimText.trim() && this.callbacks.transcription) {
                console.log('Processing final interim text on stop:', this.speechBuffer.interimText);
                this.callbacks.transcription(this.speechBuffer.interimText.trim());
            }
            
            // Clear speech buffer
            this.speechBuffer = {
                interimText: '',
                lastWebSpeechUpdate: 0,
                isGeminiProcessing: false
            };
            
            // Stop local speech recognition
            if (this.speechRecognition) {
                try {
                    this.speechRecognition.stop();
                } catch (err) {
                    console.warn('Error stopping speech recognition:', err);
                }
                this.speechRecognition = null;
            }
            
            // Stop audio processing
            this.stopAudioProcessing();
            
            // Stop Gemini streaming
            await this.geminiAPI.disconnect();
            
            // Stop screen capture
            this.screenCapture.stop();
            
            // Clear timers and stop all streaming
            this.clearInactivityTimer();
            this.clearSpeechKeepAlive();
            this.stopScreenshotStreaming();
            
            // Reset streaming flags for next session
            this.videoStreamingStarted = false;
            this.audioStreamingStarted = false;
            
            return { success: true };
            
        } catch (error) {
            console.error('Error stopping listening:', error);
            this.state.isListening = false;
            return { success: false, error: error.message };
        }
    }

    async setupAudioCapture() {
        try {
            // Get microphone audio
            this.audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    // More aggressive echo cancellation
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true
                }
            });
            
            return true;
        } catch (error) {
            console.error('Audio capture setup failed:', error);
            throw error;
        }
    }

    async startMediaStreaming() {
        // Wait for Gemini setup to complete
        let waitCount = 0;
        while (!this.geminiAPI.getConnectionStatus().isSetupComplete && waitCount < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
        }
        
        if (!this.geminiAPI.getConnectionStatus().isSetupComplete) {
            throw new Error('Gemini setup did not complete in time');
        }
        
        // Don't start video or audio streaming yet - wait for first speech detection
        this.videoStreamingStarted = false;
        this.audioStreamingStarted = false;
    }

    startScreenshotStreaming() {
        if (!this.screenCapture.isActive() || !this.geminiAPI.getConnectionStatus().isConnected) {
            console.log('Screenshot streaming skipped - screenActive:', this.screenCapture.isActive(), 'geminiConnected:', this.geminiAPI.getConnectionStatus().isConnected);
            return;
        }

        // Send first screenshot immediately
        this.captureAndSendScreenshot();

        // Then send screenshots at 2 FPS (every 500ms) during speech
        this.screenshotInterval = setInterval(() => {
            if (!this.screenCapture.isActive() || !this.geminiAPI.getConnectionStatus().isConnected) {
                console.log('Screenshot interval check failed - screenActive:', this.screenCapture.isActive(), 'geminiConnected:', this.geminiAPI.getConnectionStatus().isConnected);
                this.stopScreenshotStreaming();
                return;
            }
            
            this.captureAndSendScreenshot();
        }, 500); // 2 FPS
    }

    async captureAndSendScreenshot() {
        try {
            const base64Data = await this.screenCapture.captureScreenshot();
            console.log('Sending screenshot to Gemini, size:', Math.round(base64Data.length * 0.75), 'bytes');
            this.geminiAPI.sendVideoFrame(base64Data);
        } catch (error) {
            console.error('Screenshot capture error:', error);
        }
    }

    stopScreenshotStreaming() {
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
            console.log('Screenshot streaming stopped');
        }
    }

    stopAudioStreaming() {
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
        
        console.log('Audio streaming to Gemini stopped');
    }

    async startAudioStreaming() {
        if (!this.geminiAPI.getConnectionStatus().isConnected) {
            return;
        }

        try {
            // Use AudioWorklet for real-time PCM conversion
            if (this.geminiAPI.audioContext.audioWorklet) {
                await this.startAudioWorkletProcessing();
            } else {
                console.warn('AudioWorklet not supported, using fallback');
                this.startScriptProcessorFallback();
            }
        } catch (error) {
            console.error('Audio streaming failed:', error);
            this.startScriptProcessorFallback();
        }
    }

    async startAudioWorkletProcessing() {
        const processorUrl = chrome.runtime.getURL('src/audio/pcm-processor.js');
        await this.geminiAPI.audioContext.audioWorklet.addModule(processorUrl);
        
        this.audioWorkletNode = new AudioWorkletNode(this.geminiAPI.audioContext, 'pcm-processor');
        
        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, pcmData } = event.data;
            
            if (type === 'audioData' && this.geminiAPI.getConnectionStatus().isConnected) {
                const uint8Array = new Uint8Array(pcmData.buffer);
                const base64 = btoa(String.fromCharCode(...uint8Array));
                this.geminiAPI.sendAudioChunk(base64);
            }
        };
        
        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(this.audioStream);
        this.audioSource.connect(this.audioWorkletNode);
        // DO NOT connect to destination to avoid feedback loop
    }

    startScriptProcessorFallback() {
        this.audioSource = this.geminiAPI.audioContext.createMediaStreamSource(this.audioStream);
        this.audioProcessor = this.geminiAPI.audioContext.createScriptProcessor(4096, 1, 1);
        
        this.audioProcessor.onaudioprocess = (event) => {
            if (!this.geminiAPI.getConnectionStatus().isConnected) return;
            
            const inputData = event.inputBuffer.getChannelData(0);
            const outputData = event.outputBuffer.getChannelData(0);
            
            // Copy input to output
            for (let i = 0; i < inputData.length; i++) {
                outputData[i] = inputData[i];
            }
            
            // Convert to PCM and send to Gemini
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const sample = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
            
            const uint8Array = new Uint8Array(pcmData.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));
            this.geminiAPI.sendAudioChunk(base64);
        };
        
        this.audioSource.connect(this.audioProcessor);
        // DO NOT connect to destination to avoid feedback loop
    }

    stopAudioProcessing() {
        // Stop streaming to Gemini
        this.stopAudioStreaming();
        
        // Stop the actual microphone stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
    }

    startLocalSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('Speech recognition not supported');
            return;
        }

        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = 'en-US';

        this.speechRecognition.onresult = async (event) => {
            this.resetInactivityTimer();
            this.lastSpeechActivity = Date.now();
            
            // Start audio and video streaming on first speech detection
            if (!this.audioStreamingStarted) {
                console.log('First speech detected - starting audio and video streaming');
                
                // Set flags immediately to prevent race conditions from rapid speech events
                this.audioStreamingStarted = true;
                this.videoStreamingStarted = true;
                
                // Start audio streaming to Gemini
                await this.startAudioStreaming();
                
                // Start screenshot streaming if available
                if (this.screenCapture.hasStream()) {
                    this.startScreenshotStreaming();
                }
            }
            
            // Only process the latest result to avoid accumulating old speech
            let latestTranscript = '';
            let hasInterimResults = false;
            
            // Get only the most recent result (not all accumulated results)
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;
                
                latestTranscript += transcript;
                
                if (!isFinal) {
                    hasInterimResults = true;
                }
            }
            
            // Update speech buffer with only the latest transcript segment
            this.speechBuffer.interimText = latestTranscript;
            this.speechBuffer.lastWebSpeechUpdate = Date.now();
            
            // Show only the latest interim text in UI
            if (hasInterimResults && this.callbacks.interim) {
                this.callbacks.interim(latestTranscript);
            }
            
            // NOTE: Final transcriptions are now handled by Gemini responses only
            // We don't create message bubbles from Web Speech API anymore
        };

        this.speechRecognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            
            const timeoutErrors = ['no-speech', 'network'];
            if (this.state.isListening && timeoutErrors.includes(event.error)) {
                setTimeout(() => {
                    if (this.state.isListening) {
                        this.restartSpeechRecognition();
                    }
                }, 1000);
            }
        };

        this.speechRecognition.onend = () => {
            if (this.state.isListening) {
                const now = Date.now();
                const timeSinceLastActivity = now - (this.lastSpeechActivity || now);
                
                if (timeSinceLastActivity < 30000) {
                    setTimeout(() => {
                        if (this.state.isListening) {
                            this.restartSpeechRecognition();
                        }
                    }, 100);
                }
            }
        };

        try {
            this.speechRecognition.start();
        } catch (error) {
            console.error('Failed to start speech recognition:', error);
        }
    }

    restartSpeechRecognition() {
        try {
            if (this.speechRecognition) {
                this.speechRecognition.stop();
            }
            
            setTimeout(() => {
                if (this.state.isListening) {
                    this.startLocalSpeechRecognition();
                }
            }, 200);
        } catch (error) {
            console.error('Error restarting speech recognition:', error);
        }
    }

    startSpeechKeepAlive() {
        this.clearSpeechKeepAlive();
        this.lastSpeechActivity = Date.now();
        
        this.speechKeepAliveTimer = setInterval(() => {
            if (!this.state.isListening) {
                this.clearSpeechKeepAlive();
                return;
            }
            
            // Check for orphaned speech every cycle
            this.checkForOrphanedSpeech();
            
            const now = Date.now();
            const timeSinceLastActivity = now - (this.lastSpeechActivity || now);
            
            if (timeSinceLastActivity > 30000) {
                this.restartSpeechRecognition();
            }
        }, 5000); // Check more frequently (every 5 seconds)
    }

    clearSpeechKeepAlive() {
        if (this.speechKeepAliveTimer) {
            clearInterval(this.speechKeepAliveTimer);
            this.speechKeepAliveTimer = null;
        }
    }

    resetInactivityTimer() {
        this.clearInactivityTimer();
        
        this.inactivityTimer = setTimeout(() => {
            this.stopListening();
            if (this.callbacks.status) {
                this.callbacks.status('Session timed out', 'warning', 5000);
            }
        }, 20 * 60 * 1000); // 20 minutes
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    // Callback setters
    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    setBotResponseCallback(callback) {
        this.callbacks.botResponse = callback;
    }

    setStatusCallback(callback) {
        this.callbacks.status = callback;
    }

    // Getters
    isListening() {
        return this.state.isListening;
    }

    isProcessingResponse() {
        return this.state.isProcessingResponse;
    }
}