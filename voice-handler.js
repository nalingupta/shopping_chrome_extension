// Voice input handler using Web Speech API
class VoiceInputHandler {
    // Configuration constants
    static CONFIG = {
        LANGUAGE: 'en-US',
        RESTART_DELAY: 1000,
        PERMISSION_TIMEOUT: 30000
    };

    static ERROR_MESSAGES = {
        'no-speech': "No speech detected. Please speak clearly and try again.",
        'audio-capture': "Microphone not found. Please check your microphone connection.",
        'not-allowed': "Microphone access denied. Click the microphone icon in your browser's address bar to allow access.",
        'network': "Network error occurred. Please check your internet connection.",
        'not_supported': "Voice input requires Chrome or Edge browser. Please switch browsers or use text input.",
        'content_script_failed': "Voice input unavailable on this page. Try refreshing or visit a different website.",
        'permission_timeout': "Permission request timed out. Please try again.",
        'initialization_failed': "Voice recognition failed to start. Please refresh and try again."
    };

    static ERROR_RECOVERY = {
        'no-speech': 'Try speaking louder or closer to your microphone',
        'audio-capture': 'Check microphone settings in your system preferences',
        'not-allowed': 'Enable microphone permissions for this site',
        'network': 'Reconnect to the internet and try again',
        'not_supported': 'Use the text input field below instead',
        'content_script_failed': 'Voice input works on most websites - try a different page'
    };

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

        this.initializeWebSpeechAPI();
    }

    initializeWebSpeechAPI() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('Web Speech API not supported');
            return;
        }

        this.state.isSupported = true;
        this.recognition = new SpeechRecognition();
        
        // Configure recognition
        Object.assign(this.recognition, {
            continuous: true,
            interimResults: true,
            lang: VoiceInputHandler.CONFIG.LANGUAGE,
            maxAlternatives: 1
        });

        this.setupEventHandlers();
        console.log('Web Speech API initialized');
    }

    setupEventHandlers() {
        this.recognition.onstart = () => {
            console.log('Speech recognition started');
            this.state.isListening = true;
        };

        this.recognition.onresult = (event) => {
            const { finalTranscript, interimTranscript } = this.processResults(event);
            
            if (finalTranscript && this.callbacks.transcription) {
                console.log('Final transcript:', finalTranscript);
                this.callbacks.transcription(finalTranscript.trim());
                
                // Auto-restart if still listening
                if (this.state.isListening && !this.state.isProcessingResponse) {
                    this.scheduleRestart();
                }
            }

            if (interimTranscript && this.callbacks.interim) {
                this.callbacks.interim(interimTranscript);
            }
        };

        this.recognition.onerror = (event) => {
            this.state.isListening = false;
            this.reportError(event.error, `Recognition error: ${event.error}`);
        };

        this.recognition.onend = () => {
            console.log('Speech recognition ended');
            
            if (this.state.isListening && !this.state.isProcessingResponse) {
                this.scheduleRestart();
            } else {
                this.state.isListening = false;
            }
        };
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
        const message = VoiceInputHandler.ERROR_MESSAGES[errorType];
        const recovery = VoiceInputHandler.ERROR_RECOVERY[errorType];
        
        if (message) {
            return recovery ? 
                `Speech recognition failed. ${message}\n\n💡 Tip: ${recovery}` : 
                `Speech recognition failed. ${message}`;
        }
        
        return `Speech recognition failed. Error: ${errorType}`;
    }

    // Enhanced error reporting with context
    reportError(errorType, context = '') {
        const errorMessage = this.getErrorMessage(errorType);
        console.error(`Voice Handler Error [${errorType}]:`, context || errorMessage);
        
        if (this.callbacks.transcription) {
            this.callbacks.transcription(errorMessage);
        }
        
        return { success: false, error: errorType, message: errorMessage };
    }

    // Public API methods
    async requestMicrophonePermission() {
        try {
            console.log('Requesting microphone permission...');
            
            const response = await Promise.race([
                chrome.runtime.sendMessage({ type: "REQUEST_MIC_PERMISSION" }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), VoiceInputHandler.CONFIG.PERMISSION_TIMEOUT)
                )
            ]);
            
            if (response?.success) {
                console.log('Microphone permission granted');
            } else {
                console.warn('Microphone permission denied:', response?.error);
            }
            
            return response;
        } catch (error) {
            if (error.message === 'Request timeout') {
                return this.reportError('permission_timeout', 'Permission request timed out');
            }
            
            return this.reportError('request_failed', `Permission request failed: ${error.message}`);
        }
    }

    async startListening() {
        if (this.state.isListening) {
            return { success: false, error: "already_listening", message: "Voice recognition is already active" };
        }

        if (!this.state.isSupported) {
            return this.reportError('not_supported');
        }

        try {
            this.recognition.start();
            this.state.isListening = true;
            console.log('Voice recognition started successfully');
            return { success: true };
        } catch (error) {
            return this.reportError('initialization_failed', `Start failed: ${error.message}`);
        }
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: "not_listening", message: "Voice recognition is not active" };
        }

        try {
            this.state.isListening = false;
            this.clearRestart();
            
            if (this.recognition) {
                this.recognition.stop();
            }
            
            console.log('Voice recognition stopped successfully');
            return { success: true };
        } catch (error) {
            this.state.isListening = false;
            return this.reportError('stop_failed', `Stop failed: ${error.message}`);
        }
    }

    // Callback setters
    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    // Response processing control
    notifyResponseProcessing(isProcessing) {
        this.state.isProcessingResponse = isProcessing;
        
        if (!isProcessing && this.state.isListening) {
            this.scheduleRestart();
        }
    }

    // Private helper methods
    scheduleRestart() {
        this.clearRestart();
        
        this.restartTimer = setTimeout(() => {
            if (this.state.isListening && !this.state.isProcessingResponse) {
                console.log('Auto-restarting speech recognition');
                try {
                    this.recognition.start();
                } catch (error) {
                    console.error('Restart failed:', error);
                }
            }
        }, VoiceInputHandler.CONFIG.RESTART_DELAY);
    }

    clearRestart() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    // Legacy compatibility method
    getErrorHelp(errorType) {
        return VoiceInputHandler.ERROR_MESSAGES[errorType] || "An error occurred. Please try again.";
    }
}

// Export for use in sidepanel.js
if (typeof module !== "undefined" && module.exports) {
    module.exports = VoiceInputHandler;
}
