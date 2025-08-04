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
        
        this.geminiAPI = new GeminiLiveAPI();
        this.screenCapture = new ScreenCapture();
        this.speechRecognition = null;
        this.audioStream = null;
        this.audioWorkletNode = null;
        this.audioSource = null;
        this.inactivityTimer = null;
        this.speechKeepAliveTimer = null;
        this.lastSpeechActivity = null;
        
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
            if (data.text && this.callbacks.botResponse) {
                this.callbacks.botResponse(data);
            }
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

            // Setup screen capture (optional)
            try {
                await this.screenCapture.setup();
            } catch (error) {
                console.log('Continuing without screen sharing - using audio only');
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
            
            // Clear timers
            this.clearInactivityTimer();
            this.clearSpeechKeepAlive();
            
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
        // Wait for Gemini setup to complete
        let waitCount = 0;
        while (!this.geminiAPI.getConnectionStatus().isSetupComplete && waitCount < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
        }
        
        if (!this.geminiAPI.getConnectionStatus().isSetupComplete) {
            throw new Error('Gemini setup did not complete in time');
        }
        
        // Start video streaming if available
        if (this.screenCapture.hasStream()) {
            this.startVideoStreaming();
        }
        
        // Start audio streaming
        if (this.audioStream) {
            await this.startAudioStreaming();
        }
    }

    startVideoStreaming() {
        const stream = this.screenCapture.getStream();
        if (!stream) return;

        const video = document.createElement('video');
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            video.play();
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Send video frames at 2 FPS
            this.videoInterval = setInterval(() => {
                if (!this.screenCapture.isActive() || !this.geminiAPI.getConnectionStatus().isConnected) {
                    return;
                }
                
                try {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0);
                    
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const base64 = reader.result.split(',')[1];
                                this.geminiAPI.sendVideoFrame(base64);
                            };
                            reader.readAsDataURL(blob);
                        }
                    }, 'image/jpeg', 0.8);
                    
                } catch (error) {
                    console.error('Video frame capture error:', error);
                }
            }, 500);
        };
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
        this.audioWorkletNode.connect(this.geminiAPI.audioContext.destination);
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
        this.audioProcessor.connect(this.geminiAPI.audioContext.destination);
    }

    stopAudioProcessing() {
        if (this.videoInterval) {
            clearInterval(this.videoInterval);
            this.videoInterval = null;
        }
        
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

        this.speechRecognition.onresult = (event) => {
            this.resetInactivityTimer();
            this.lastSpeechActivity = Date.now();
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;

                if (isFinal) {
                    if (this.callbacks.transcription) {
                        this.callbacks.transcription(transcript);
                    }
                } else {
                    if (this.callbacks.interim) {
                        this.callbacks.interim(transcript);
                    }
                }
            }
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
            
            const now = Date.now();
            const timeSinceLastActivity = now - (this.lastSpeechActivity || now);
            
            if (timeSinceLastActivity > 30000) {
                this.restartSpeechRecognition();
            }
        }, 45000);
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