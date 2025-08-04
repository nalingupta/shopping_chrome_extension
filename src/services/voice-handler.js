import { VOICE_CONFIG, ERROR_MESSAGES, ERROR_RECOVERY } from '../utils/constants.js';

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
        
        this.configureRecognition();
        this.setupEventHandlers();
        
        console.log('Web Speech API initialized');
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

    handleStart() {
        console.log('Speech recognition started');
        this.state.isListening = true;
    }

    handleResult(event) {
        const { finalTranscript, interimTranscript } = this.processResults(event);
        
        if (finalTranscript && this.callbacks.transcription) {
            console.log('Final transcript:', finalTranscript);
            this.callbacks.transcription(finalTranscript.trim());
            
            if (this.state.isListening && !this.state.isProcessingResponse) {
                this.scheduleRestart();
            }
        }

        if (interimTranscript && this.callbacks.interim) {
            this.callbacks.interim(interimTranscript);
        }
    }

    handleError(event) {
        this.state.isListening = false;
        this.reportError(event.error, `Recognition error: ${event.error}`);
    }

    handleEnd() {
        console.log('Speech recognition ended');
        
        if (this.state.isListening && !this.state.isProcessingResponse) {
            this.scheduleRestart();
        } else {
            this.state.isListening = false;
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

    reportError(errorType, context = '') {
        const errorMessage = this.getErrorMessage(errorType);
        console.error(`Voice Handler Error [${errorType}]:`, context || errorMessage);
        
        if (this.callbacks.transcription) {
            this.callbacks.transcription(errorMessage);
        }
        
        return { success: false, error: errorType, message: errorMessage };
    }

    async requestMicrophonePermission() {
        try {
            console.log('Requesting microphone permission...');
            
            const response = await Promise.race([
                chrome.runtime.sendMessage({ type: "REQUEST_MIC_PERMISSION" }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), VOICE_CONFIG.PERMISSION_TIMEOUT)
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
                console.log('Auto-restarting speech recognition');
                try {
                    this.recognition.start();
                } catch (error) {
                    console.error('Restart failed:', error);
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
}