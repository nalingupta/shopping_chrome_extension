import { VOICE_CONFIG, ERROR_MESSAGES, ERROR_RECOVERY } from '../utils/constants.js';
import { ScreenRecorder } from './screen-recorder.js';
import { PipecatStreamingService } from './pipecat-streaming.js';
import { API_CONFIG } from '../config/api-keys.js';

export class VoiceInputHandler {
    constructor() {
        this.state = {
            isListening: false,
            isProcessingResponse: false,
            isSupported: false
        };
        
        this.callbacks = {
            transcription: null,
            interim: null
        };
        
        this.recognition = null;
        this.restartTimer = null;
        this.screenRecorder = new ScreenRecorder();
        this.pipecatService = new PipecatStreamingService();
        this.voiceStartTime = null;
        this.voiceEndTime = null;
        this.inactivityTimer = null;
        this.INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutes in milliseconds
        this.currentVideoData = null; // Store video data for current transcription
        
        // Pipecat Cloud configuration - Auto-configured with API keys
        this.useRealTimeStreaming = API_CONFIG.ENABLE_REAL_TIME_STREAMING;

        // Set up callback for when screen sharing ends
        this.screenRecorder.onScreenSharingEnded = () => {
            this.handleScreenSharingEnded();
        };

        this.initializeWebSpeechAPI();
        this.setupPipeCatCallbacks();
        
        // Auto-initialize Pipecat Cloud with hardcoded API keys
        this.initializePipecatWithApiKeys();
    }

    initializeWebSpeechAPI() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            return;
        }

        this.state.isSupported = true;
        this.recognition = new SpeechRecognition();
        
        this.configureRecognition();
        this.setupEventHandlers();
    }

    configureRecognition() {
        Object.assign(this.recognition, {
            continuous: true,
            interimResults: true,
            lang: VOICE_CONFIG.LANGUAGE,
            maxAlternatives: 1
        });
    }

    setupEventHandlers() {
        this.recognition.onstart = () => this.handleStart();
        this.recognition.onresult = (event) => this.handleResult(event);
        this.recognition.onerror = (event) => this.handleError(event);
        this.recognition.onend = () => this.handleEnd();
    }

    setupPipeCatCallbacks() {
        // User speech recognition from Pipecat
        this.pipecatService.setUserTranscriptCallback((data) => {
            if (data.final && this.callbacks.transcription) {
                this.callbacks.transcription(`🎯 You: ${data.text}`);
            } else if (!data.final && this.callbacks.interim) {
                this.callbacks.interim(data.text);
            }
        });

        // AI responses from Gemini via Pipecat
        this.pipecatService.setBotResponseCallback((data) => {
            if (this.callbacks.transcription) {
                this.callbacks.transcription(`🤖 AI Shopping Assistant:\n${data.text || data.response}`);
            }
        });

        // Connection status updates
        this.pipecatService.setConnectionStateCallback((state) => {
            // Connection state tracking (silent)
        });

        // Error handling
        this.pipecatService.setErrorCallback((error) => {
            console.error('Pipecat error:', error);
            if (this.callbacks.transcription) {
                this.callbacks.transcription(`❌ Streaming error: ${error.message}`);
            }
        });
    }

    async handleStart() {
        this.state.isListening = true;
        this.voiceStartTime = Date.now();
        this.clearInactivityTimer();
    }

    async handleResult(event) {
        const { finalTranscript, interimTranscript } = this.processResults(event);
        
        // Start screen recording on first speech detection
        if ((finalTranscript || interimTranscript) && !this.screenRecorder.isRecording) {
            this.startScreenRecordingOnSpeech();
        }
        
        if (finalTranscript && this.callbacks.transcription) {
            this.voiceEndTime = Date.now();
            const videoResult = await this.stopScreenRecordingAndCreateVideo();
            
            // Store video data for the transcription callback
            this.currentVideoData = videoResult.success ? videoResult.videoData : null;
            
            this.callbacks.transcription(finalTranscript.trim());
            
            // Clear video data after callback
            this.currentVideoData = null;
            
            if (this.state.isListening && !this.state.isProcessingResponse) {
                this.scheduleRestart();
            }
        }

        if (interimTranscript && this.callbacks.interim) {
            this.callbacks.interim(interimTranscript);
        }
    }

    getCurrentVideoData() {
        return this.currentVideoData;
    }

    handleError(event) {
        this.state.isListening = false;
        
        // Don't report "aborted" errors as they're expected when closing sidepanel
        if (event.error === 'aborted') {
            return;
        }
        
        this.reportError(event.error);
    }

    handleEnd() {
        if (this.state.isListening && !this.state.isProcessingResponse) {
            this.scheduleRestart();
        } else {
            this.state.isListening = false;
            this.startInactivityTimer();
        }
    }

    processResults(event) {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        return { finalTranscript, interimTranscript };
    }

    getErrorMessage(errorType) {
        const message = ERROR_MESSAGES[errorType];
        const recovery = ERROR_RECOVERY[errorType];
        
        if (message) {
            return recovery ? 
                `Speech recognition failed. ${message}\n\n💡 Tip: ${recovery}` : 
                `Speech recognition failed. ${message}`;
        }
        
        return `Speech recognition failed. Error: ${errorType}`;
    }

    reportError(errorType) {
        const errorMessage = this.getErrorMessage(errorType);
        
        if (this.callbacks.transcription) {
            this.callbacks.transcription(errorMessage);
        }
        
        return { success: false, error: errorType, message: errorMessage };
    }

    async startListening() {
        if (this.state.isListening) {
            return { success: false, error: "already_listening", message: "Voice recognition is already active" };
        }

        try {
            // Only use Pipecat streaming - no fallbacks
            if (!this.useRealTimeStreaming || !this.isRealTimeStreamingConfigured()) {
                const errorMessage = 'Pipecat Cloud is not configured. Please check API keys.';
                if (this.callbacks.transcription) {
                    this.callbacks.transcription(errorMessage);
                }
                return { success: false, error: 'pipecat_not_configured', message: errorMessage };
            }
            
            // Start Pipecat streaming - if it fails, show error
            return await this.startRealTimeStreaming();
            
        } catch (error) {
            const errorMessage = `Pipecat Cloud failed: ${error.message}`;
            if (this.callbacks.transcription) {
                this.callbacks.transcription(errorMessage);
            }
            return { success: false, error: 'pipecat_failed', message: errorMessage };
        }
    }

    async startRealTimeStreaming() {
        try {
            // Initialize Pipecat Cloud (no configuration needed)
            const initResult = await this.pipecatService.initialize();
            if (!initResult.success) {
                console.error('Pipecat initialization failed:', initResult.error);
                throw new Error(initResult.error);
            }

            // Start real-time streaming with Pipecat Cloud
            const streamResult = await this.pipecatService.startStreaming();
            if (!streamResult.success) {
                console.error('Pipecat streaming failed:', streamResult.error);
                throw new Error(streamResult.error);
            }

            // Also start Web Speech API for UI transcription display (not for processing)
            if (this.state.isSupported) {
                this.recognition.start();
            }

            this.state.isListening = true;
            this.clearInactivityTimer();
            
            return { 
                success: true, 
                message: "Pipecat Cloud streaming started (raw audio + screen → Pipecat → Gemini)",
                mode: "pipecat_only"
            };
        } catch (error) {
            console.error('Pipecat streaming error:', error);
            const errorMessage = `Pipecat streaming failed: ${error.message}`;
            if (this.callbacks.transcription) {
                this.callbacks.transcription(errorMessage);
            }
            return { success: false, error: 'pipecat_streaming_failed', message: errorMessage };
        }
    }

    async startTraditionalVoiceRecognition() {
        if (!this.state.isSupported) {
            const errorMessage = this.getErrorMessage('not_supported');
            if (this.callbacks.transcription) {
                this.callbacks.transcription(errorMessage);
            }
            return { success: false, error: 'not_supported', message: errorMessage };
        }

        this.recognition.start();
        this.state.isListening = true;
        this.clearInactivityTimer();
        
        return { 
            success: true,
            mode: "traditional"
        };
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: "not_listening", message: "Voice recognition is not active" };
        }

        try {
            this.state.isListening = false;
            this.clearRestart();
            this.startInactivityTimer();
            
            // Stop real-time streaming if active
            if (this.pipecatService.getConnectionStatus().isStreaming) {
                await this.pipecatService.stopStreaming();
            }
            
            // Stop traditional voice recognition if active
            if (this.recognition) {
                this.recognition.stop();
            }
            
            return { success: true };
        } catch (error) {
            this.state.isListening = false;
            this.startInactivityTimer();
            const errorMessage = `Stop failed: ${error.message}`;
            if (this.callbacks.transcription) {
                this.callbacks.transcription(errorMessage);
            }
            return { success: false, error: 'stop_failed', message: errorMessage };
        }
    }

    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    notifyResponseProcessing(isProcessing) {
        this.state.isProcessingResponse = isProcessing;
        
        if (!isProcessing && this.state.isListening) {
            this.scheduleRestart();
        }
    }

    scheduleRestart() {
        this.clearRestart();
        
        this.restartTimer = setTimeout(() => {
            if (this.state.isListening && !this.state.isProcessingResponse) {
                try {
                    this.recognition.start();
                } catch (error) {
                }
            }
        }, VOICE_CONFIG.RESTART_DELAY);
    }

    clearRestart() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    getErrorHelp(errorType) {
        return ERROR_MESSAGES[errorType] || "An error occurred. Please try again.";
    }

    async startScreenRecordingOnSpeech() {
        try {
            await this.screenRecorder.startRecording();
        } catch (error) {
        }
    }

    async stopScreenRecordingAndCreateVideo() {
        try {
            const recordingData = await Promise.race([
                this.screenRecorder.stopRecording(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Recording stop timeout')), 10000)
                )
            ]);
            
            
            if (recordingData?.videoBlob) {
                const videoBlob = await this.screenRecorder.createVideo(recordingData);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `voice-screen-recording-${timestamp}.webm`;
                
                // Create video data for display instead of downloading
                const videoData = this.screenRecorder.createVideoData(videoBlob, filename, recordingData.duration);
                
                return {
                    success: true,
                    videoData,
                    filename,
                    duration: recordingData.duration,
                    hasAudio: recordingData.hasAudio,
                    fileSize: recordingData.videoBlob.size
                };
            }
            
            return { success: false, error: 'No recording data' };

        } catch (error) {
            // Handle stream cleanup based on error type
            const isStreamError = error.message.includes('stream ended') || error.message.includes('track ended');
            this.screenRecorder.cleanup(isStreamError);
            
            return { success: false, error: error.message };
        }
    }

    startInactivityTimer() {
        this.clearInactivityTimer();
        
        this.inactivityTimer = setTimeout(() => {
            this.handleInactivityTimeout();
        }, this.INACTIVITY_TIMEOUT);
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    async handleInactivityTimeout() {
        try {
            // Stop screen recording if active
            if (this.screenRecorder.isRecording) {
                await this.screenRecorder.stopRecording();
            }
            
            // Clean up screen stream and permissions
            this.screenRecorder.cleanup(true);
            
        } catch (error) {
            // Force cleanup even if there's an error
            this.screenRecorder.cleanup(true);
        }
    }


    handleScreenSharingEnded() {
        // Clear any pending timers first
        this.clearInactivityTimer();
        this.clearRestart();
        
        // Force stop the recognition without going through normal flow
        this.state.isListening = false;
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (error) {
                // Handle silently
            }
        }
        
        // Notify UI that voice input has been stopped due to screen sharing ending
        if (this.callbacks.transcription) {
            this.callbacks.transcription("🛑 Voice input stopped - screen sharing ended. Click the microphone to start again.");
        }
    }

    // Pipecat configuration methods - now using hardcoded API keys
    async configurePipecat(config) {
        // Configuration is now hardcoded in API_CONFIG - no runtime configuration needed
        return { success: true, message: 'Pipecat pre-configured with API keys' };
    }

    isRealTimeStreamingConfigured() {
        return !!(API_CONFIG.GEMINI_API_KEY && API_CONFIG.DAILY_API_KEY && API_CONFIG.PIPECAT_PUBLIC_API_KEY);
    }

    getRealTimeStreamingStatus() {
        return {
            configured: this.isRealTimeStreamingConfigured(),
            enabled: this.useRealTimeStreaming,
            connection: this.pipecatService.getConnectionStatus(),
            config: {
                hasGeminiKey: !!API_CONFIG.GEMINI_API_KEY,
                hasDailyKey: !!API_CONFIG.DAILY_API_KEY,
                hasPipecatKey: !!API_CONFIG.PIPECAT_PUBLIC_API_KEY,
                cloudApiUrl: API_CONFIG.PIPECAT_CLOUD_API_URL
            }
        };
    }

    enableRealTimeStreaming(enable = true) {
        if (enable && !this.isRealTimeStreamingConfigured()) {
            return { success: false, error: 'Real-time streaming not configured' };
        }
        
        this.useRealTimeStreaming = enable;
        return { success: true, message: `Real-time streaming ${enable ? 'enabled' : 'disabled'}` };
    }

    async initializePipecatWithApiKeys() {
        try {
            // Initialize Pipecat Cloud service (no configuration needed - uses hardcoded keys)
            const initResult = await this.pipecatService.initialize();
            
            if (!initResult.success) {
                console.error('Pipecat Cloud initialization failed:', initResult.error);
                // Fallback to traditional mode
                this.useRealTimeStreaming = false;
            }
        } catch (error) {
            console.error('Pipecat Cloud auto-initialization error:', error);
            // Fallback to traditional mode
            this.useRealTimeStreaming = false;
        }
    }
}