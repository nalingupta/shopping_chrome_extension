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
        console.log('Voice recognition started - preparing screen recording...');
        
        // Request screen permission once when voice recognition starts
        await this.prepareScreenRecording();
    }

    async prepareScreenRecording() {
        try {
            // Check if screen permission is available or needs re-requesting
            const hasPermission = await this.screenRecorder.requestScreenPermissionIfNeeded();
            
            if (hasPermission) {
                if (this.screenRecorder.needsPermissionReRequest) {
                    console.log('✅ Screen permission re-granted after user stopped sharing');
                } else {
                    console.log('✅ Screen permission available - ready for recording');
                }
            } else {
                console.error('❌ Failed to get screen permission');
            }
        } catch (error) {
            console.error('Failed to prepare screen recording:', error);
        }
    }

    handleResult(event) {
        const { finalTranscript, interimTranscript } = this.processResults(event);
        
        // Start screen recording on first speech detection (interim or final)
        if ((finalTranscript || interimTranscript) && !this.screenRecorder.isRecording) {
            console.log('Speech detected - starting screen recording with existing permission...');
            this.startScreenRecordingOnSpeech();
        }
        
        if (finalTranscript && this.callbacks.transcription) {
            this.voiceEndTime = Date.now();
            
            // Stop screen recording when final transcript is received
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
        this.reportError(event.error, `Recognition error: ${event.error}`);
    }

    handleEnd() {
        
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
        
        if (this.callbacks.transcription) {
            this.callbacks.transcription(errorMessage);
        }
        
        return { success: false, error: errorType, message: errorMessage };
    }

    async requestMicrophonePermission() {
        try {
            
            const response = await Promise.race([
                chrome.runtime.sendMessage({ type: "REQUEST_MIC_PERMISSION" }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), VOICE_CONFIG.PERMISSION_TIMEOUT)
                )
            ]);
            
            if (response?.success) {
            } else {
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
            const success = await this.screenRecorder.startRecording();
            if (success) {
                console.log('Screen recording started on speech detection');
            } else {
                console.error('Failed to start screen recording on speech');
            }
        } catch (error) {
            console.error('Screen recording startup error on speech:', error);
        }
    }

    async stopScreenRecordingAndCreateVideo() {
        try {
            // Add timeout to prevent hanging
            const recordingData = await Promise.race([
                this.screenRecorder.stopRecording(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Recording stop timeout')), 10000)
                )
            ]);
            
            if (recordingData && recordingData.videoBlob) {
                console.log(`Screen recording completed: ${recordingData.duration}ms duration, ${recordingData.videoBlob.size} bytes`);
                
                // Get the video (already created with audio)
                const videoBlob = await this.screenRecorder.createVideo(recordingData);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `voice-screen-recording-${timestamp}.webm`;
                
                this.screenRecorder.downloadVideo(videoBlob, filename);
                
                console.log(`Video downloaded: ${filename} (with audio: ${recordingData.hasAudio})`);
                
                return {
                    success: true,
                    filename: filename,
                    duration: recordingData.duration,
                    hasAudio: recordingData.hasAudio,
                    fileSize: recordingData.videoBlob.size
                };
            } else {
                console.warn('No recording data available');
                return { success: false, error: 'No recording data' };
            }
        } catch (error) {
            console.error('Failed to process screen recording:', error);
            // Always preserve screen stream unless it's a critical stream error
            if (error.message.includes('stream ended') || error.message.includes('track ended')) {
                console.warn('Screen stream ended, will need to re-request permission');
                this.screenRecorder.cleanup(true); // Only destroy on stream ended errors
            } else {
                console.log('Preserving screen stream despite error');
                this.screenRecorder.cleanup(false); // Preserve screen stream for all other errors
            }
            return { success: false, error: error.message };
        }
    }
}