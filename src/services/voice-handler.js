import { VOICE_CONFIG, ERROR_MESSAGES, ERROR_RECOVERY } from '../utils/constants.js';
import { ScreenRecorder } from './screen-recorder.js';

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
        this.voiceStartTime = null;
        this.voiceEndTime = null;
        this.inactivityTimer = null;
        this.INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Set up callback for when screen sharing ends
        this.screenRecorder.onScreenSharingEnded = () => {
            this.handleScreenSharingEnded();
        };

        this.initializeWebSpeechAPI();
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

    async handleStart() {
        this.state.isListening = true;
        this.voiceStartTime = Date.now();
        this.clearInactivityTimer();
        console.log('🎤 Voice recognition started, screen permission should already be granted');
    }

    handleResult(event) {
        const { finalTranscript, interimTranscript } = this.processResults(event);
        
        // Start screen recording on first speech detection
        if ((finalTranscript || interimTranscript) && !this.screenRecorder.isRecording) {
            console.log('🎤 Speech detected, starting screen recording...');
            this.startScreenRecordingOnSpeech();
        }
        
        if (finalTranscript && this.callbacks.transcription) {
            this.voiceEndTime = Date.now();
            console.log('🎤 Final transcript received, stopping recording...');
            this.stopScreenRecordingAndCreateVideo();
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
            // Use sidepanel voice recognition
            if (!this.state.isSupported) {
                return this.reportError('not_supported');
            }

            this.recognition.start();
            this.state.isListening = true;
            this.clearInactivityTimer();
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
            this.startInactivityTimer();
            
            if (this.recognition) {
                this.recognition.stop();
            }
            
            return { success: true };
        } catch (error) {
            this.state.isListening = false;
            this.startInactivityTimer();
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
            console.log('📹 Attempting to start screen recording...');
            const success = await this.screenRecorder.startRecording();
            console.log('📹 Screen recording start result:', success);
        } catch (error) {
            console.error('📹 Screen recording failed:', error);
        }
    }

    async stopScreenRecordingAndCreateVideo() {
        try {
            console.log('📹 Attempting to stop screen recording...');
            const recordingData = await Promise.race([
                this.screenRecorder.stopRecording(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Recording stop timeout')), 10000)
                )
            ]);
            
            console.log('📹 Recording data received:', recordingData);
            
            if (recordingData?.videoBlob) {
                console.log('📹 Creating video from recording data...');
                const videoBlob = await this.screenRecorder.createVideo(recordingData);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `voice-screen-recording-${timestamp}.webm`;
                
                console.log('📹 Downloading video:', filename);
                this.screenRecorder.downloadVideo(videoBlob, filename);
                
                return {
                    success: true,
                    filename,
                    duration: recordingData.duration,
                    hasAudio: recordingData.hasAudio,
                    fileSize: recordingData.videoBlob.size
                };
            }
            
            console.warn('📹 No recording data available');
            return { success: false, error: 'No recording data' };

        } catch (error) {
            console.error('📹 Error stopping recording:', error);
            // Handle stream cleanup based on error type
            const isStreamError = error.message.includes('stream ended') || error.message.includes('track ended');
            this.screenRecorder.cleanup(isStreamError);
            
            return { success: false, error: error.message };
        }
    }

    startInactivityTimer() {
        this.clearInactivityTimer();
        
        this.inactivityTimer = setTimeout(() => {
            console.log('🎤 Microphone inactive for 5 minutes, stopping screen sharing...');
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
                console.log('📹 Auto-stopping screen recording due to inactivity...');
                await this.screenRecorder.stopRecording();
            }
            
            // Clean up screen stream and permissions
            this.screenRecorder.cleanup(true);
            console.log('📹 Screen sharing stopped due to 5 minutes of microphone inactivity');
            
        } catch (error) {
            console.error('📹 Error during inactivity cleanup:', error);
            // Force cleanup even if there's an error
            this.screenRecorder.cleanup(true);
        }
    }

    handleScreenSharingEnded() {
        console.log('🎤 Screen sharing ended, stopping voice input for safety');
        
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
}