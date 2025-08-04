// Offscreen document for persistent audio capture
// This maintains the audio stream even when the sidebar closes

class OffscreenAudioCapture {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.stream = null;
        this.hasPermission = false;
        
        this.initializeMessageListener();
        console.log('Offscreen audio capture initialized');
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Offscreen received message:', request.type);
            
            switch(request.type) {
                case 'INIT_AUDIO':
                    this.initializeAudio().then(sendResponse);
                    return true;
                    
                case 'START_RECORDING':
                    this.startRecording().then(sendResponse);
                    return true;
                    
                case 'STOP_RECORDING':
                    this.stopRecording().then(sendResponse);
                    return true;
                    
                case 'CHECK_STATUS':
                    sendResponse({
                        isRecording: this.isRecording,
                        hasPermission: this.hasPermission,
                        hasStream: !!this.stream
                    });
                    return false;
                    
                case 'PING':
                    sendResponse({ type: 'PONG', ready: true });
                    return false;
            }
        });
    }

    async initializeAudio() {
        try {
            // Check if we already have permission
            if (this.hasPermission && this.stream) {
                return { success: true, alreadyInitialized: true };
            }

            console.log('Attempting to initialize audio in offscreen document...');
            
            // Request microphone access
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            this.hasPermission = true;
            console.log('Audio initialized successfully in offscreen');
            
            // Keep the stream alive but don't start recording yet
            return { success: true };
            
        } catch (error) {
            console.error('Failed to initialize audio in offscreen:', error);
            
            let errorType = 'unknown';
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorType = 'permission_denied';
                console.log('Permission denied - need to request through content script');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorType = 'no_microphone';
            } else if (error.name === 'NotSupportedError') {
                errorType = 'not_supported';
            }
            
            return {
                success: false,
                error: errorType,
                details: error.message
            };
        }
    }

    async startRecording() {
        try {
            if (this.isRecording) {
                return { success: false, error: 'already_recording' };
            }

            // Ensure we have audio stream
            if (!this.stream) {
                const initResult = await this.initializeAudio();
                if (!initResult.success) {
                    return initResult;
                }
            }

            // Create MediaRecorder
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
                ? 'audio/webm' 
                : 'audio/ogg';
                
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    console.log('Audio chunk received:', { size: event.data.size, chunks: this.audioChunks.length });
                }
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                console.log('Recording stopped, processing audio:', {
                    blobSize: audioBlob.size,
                    chunks: this.audioChunks.length,
                    mimeType: mimeType
                });
                
                // Convert to base64 for message passing
                const base64Audio = await this.blobToBase64(audioBlob);
                console.log('Audio converted to base64:', { length: base64Audio.length });
                
                // Send the audio data to the service worker
                chrome.runtime.sendMessage({
                    type: 'AUDIO_RECORDED',
                    audioData: base64Audio,
                    mimeType: mimeType
                });
                
                console.log('Recording completed and sent to background');
            };

            // Start recording with timeslice to get data every 1 second
            this.mediaRecorder.start(1000);
            this.isRecording = true;
            
            console.log('Recording started');
            return { success: true };
            
        } catch (error) {
            console.error('Failed to start recording:', error);
            return {
                success: false,
                error: 'recording_failed',
                details: error.message
            };
        }
    }

    async stopRecording() {
        try {
            if (!this.isRecording) {
                return { success: false, error: 'not_recording' };
            }

            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }

            this.isRecording = false;
            
            // Keep the stream alive for future recordings
            // Don't stop the tracks here
            
            console.log('Recording stopped');
            return { success: true };
            
        } catch (error) {
            console.error('Failed to stop recording:', error);
            return {
                success: false,
                error: 'stop_failed',
                details: error.message
            };
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

    // Clean up resources when offscreen document is closed
    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.hasPermission = false;
    }
}

// Initialize the audio capture handler
const audioCapture = new OffscreenAudioCapture();

// Clean up on unload
window.addEventListener('unload', () => {
    audioCapture.cleanup();
});