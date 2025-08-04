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
        this.currentVideoData = null; // Store video data for current transcription

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
}