// Voice input handler for the sidePanel
// This manages voice recording through the offscreen document

class VoiceInputHandler {
    constructor() {
        this.isListening = false;
        this.transcriptionCallback = null;
        this.recognition = null;
        this.continuousRestartTimer = null;
        this.isProcessingResponse = false;

        // Initialize Web Speech API
        this.initializeWebSpeechAPI();

        // Set up message listener for audio data (keeping for backward compatibility)
        this.setupMessageListener();

        // Check initial offscreen status
        this.checkOffscreenStatus();
    }

    initializeWebSpeechAPI() {
        // Check if Web Speech API is supported
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            
            // Configure speech recognition
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            this.recognition.maxAlternatives = 1;

            // Set up event handlers
            this.recognition.onstart = () => {
                console.log('Speech recognition started');
                this.isListening = true;
            };

            this.recognition.onresult = (event) => {
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

                if (finalTranscript) {
                    console.log('Final speech recognition result:', finalTranscript);
                    
                    if (this.transcriptionCallback) {
                        this.transcriptionCallback(finalTranscript.trim());
                    }

                    // Keep listening after processing (auto-restart)
                    if (this.isListening && !this.isProcessingResponse) {
                        this.scheduleRestart();
                    }
                }

                // Show interim results for better UX
                if (interimTranscript && this.interimCallback) {
                    this.interimCallback(interimTranscript);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.isListening = false;
                
                let errorMessage = "Speech recognition failed. ";
                switch (event.error) {
                    case 'no-speech':
                        errorMessage += "No speech detected. Please try again.";
                        break;
                    case 'audio-capture':
                        errorMessage += "No microphone found or audio capture failed.";
                        break;
                    case 'not-allowed':
                        errorMessage += "Microphone access denied. Please allow microphone permissions.";
                        break;
                    case 'network':
                        errorMessage += "Network error occurred.";
                        break;
                    default:
                        errorMessage += `Error: ${event.error}`;
                }
                
                if (this.transcriptionCallback) {
                    this.transcriptionCallback(errorMessage);
                }
            };

            this.recognition.onend = () => {
                console.log('Speech recognition ended');
                
                // Auto-restart if still in listening mode
                if (this.isListening && !this.isProcessingResponse) {
                    this.scheduleRestart();
                } else {
                    this.isListening = false;
                }
            };

            console.log('Web Speech API initialized successfully');
        } else {
            console.warn('Web Speech API not supported in this browser');
            this.recognition = null;
        }
    }

    // Configuration no longer needed - using Web Speech API

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(
            (message, sender, sendResponse) => {
                if (message.type === "AUDIO_DATA_RECEIVED") {
                    this.handleAudioDataReceived(
                        message.audioData,
                        message.mimeType
                    );
                }
            }
        );
    }

    async checkOffscreenStatus() {
        try {
            const status = await chrome.runtime.sendMessage({
                type: "CHECK_OFFSCREEN_STATUS",
            });
            console.log("Offscreen status:", status);
            return status;
        } catch (error) {
            console.error("Error checking offscreen status:", error);
            return { exists: false };
        }
    }

    async requestMicrophonePermission() {
        try {
            // First try to start recording to see if permission is already granted
            const testResponse = await chrome.runtime.sendMessage({
                type: "START_VOICE_RECORDING",
            });

            if (testResponse.success) {
                // Permission already granted, stop the test recording
                await chrome.runtime.sendMessage({
                    type: "STOP_VOICE_RECORDING",
                });
                this.permissionGranted = true;
                return { success: true, alreadyGranted: true };
            }

            if (
                testResponse.error === "permission_required" ||
                testResponse.error === "permission_denied"
            ) {
                // Need to request permission through content script
                const permissionResponse = await chrome.runtime.sendMessage({
                    type: "REQUEST_MIC_PERMISSION",
                });

                if (permissionResponse.success) {
                    this.permissionGranted = true;
                    return { success: true };
                } else {
                    return permissionResponse;
                }
            }

            // Other error
            return testResponse;
        } catch (error) {
            console.error("Error requesting microphone permission:", error);
            return {
                success: false,
                error: "request_failed",
                details: error.message,
            };
        }
    }

    async startListening() {
        try {
            // Check if already listening
            if (this.isListening) {
                return { success: false, error: "already_listening" };
            }

            // Check if Web Speech API is available
            if (!this.recognition) {
                return {
                    success: false,
                    error: "not_supported",
                    help: "Web Speech API is not supported in this browser. Please try Chrome or Edge."
                };
            }

            // Start speech recognition
            this.recognition.start();
            this.isListening = true;
            return { success: true };

        } catch (error) {
            console.error("Error starting speech recognition:", error);
            return {
                success: false,
                error: "start_failed",
                details: error.message,
                help: "Failed to start speech recognition. Please try again."
            };
        }
    }

    async stopListening() {
        if (!this.isListening) {
            return { success: false, error: "not_listening" };
        }

        try {
            this.isListening = false;
            
            // Clear any pending restart
            if (this.continuousRestartTimer) {
                clearTimeout(this.continuousRestartTimer);
                this.continuousRestartTimer = null;
            }
            
            if (this.recognition) {
                this.recognition.stop();
            }
            
            return { success: true };
        } catch (error) {
            console.error("Error stopping speech recognition:", error);
            this.isListening = false;
            return {
                success: false,
                error: "stop_failed",
                details: error.message,
            };
        }
    }

    async handleAudioDataReceived(base64Audio, mimeType) {
        // This method is kept for backward compatibility but no longer used
        // Web Speech API handles transcription directly in the event handlers
        console.log("Audio data received (legacy method):", {
            dataLength: base64Audio?.length,
            mimeType,
            hasCallback: !!this.transcriptionCallback,
        });
    }

    setTranscriptionCallback(callback) {
        this.transcriptionCallback = callback;
    }

    setInterimCallback(callback) {
        this.interimCallback = callback;
    }

    scheduleRestart() {
        // Clear any existing timer
        if (this.continuousRestartTimer) {
            clearTimeout(this.continuousRestartTimer);
        }

        // Restart after a short delay to allow for natural pauses
        this.continuousRestartTimer = setTimeout(() => {
            if (this.isListening && !this.isProcessingResponse) {
                console.log('Auto-restarting speech recognition');
                try {
                    this.recognition.start();
                } catch (error) {
                    console.error('Error restarting speech recognition:', error);
                }
            }
        }, 1000); // 1 second delay
    }

    notifyResponseProcessing(isProcessing) {
        this.isProcessingResponse = isProcessing;
        
        if (!isProcessing && this.isListening) {
            // Response processing finished, resume listening
            this.scheduleRestart();
        }
    }

    // Legacy methods removed - now using Web Speech API directly

    getErrorHelp(errorType) {
        const errorHelp = {
            permission_denied:
                "Microphone access is blocked. Please click the microphone icon in the address bar and allow access, then try again.",
            no_microphone:
                "No microphone found. Please connect a microphone and try again.",
            not_supported:
                "Voice input is not supported in this browser context. Please try updating Chrome.",
            communication_error:
                "Failed to communicate with the extension. Please refresh the page and try again.",
            offscreen_error:
                "Failed to initialize audio capture. Please refresh the page and try again.",
        };

        return errorHelp[errorType] || "An error occurred. Please try again.";
    }
}

// Export for use in sidepanel.js
if (typeof module !== "undefined" && module.exports) {
    module.exports = VoiceInputHandler;
}
