import { VOICE_CONFIG, ERROR_MESSAGES, ERROR_RECOVERY } from '../utils/constants.js';
import { ScreenRecorder } from './screen-recorder.js';
import { GeminiLiveStreamingService } from './gemini-live-streaming.js';
import { API_CONFIG } from '../config/api-keys.js';

export class GeminiVoiceHandler {
    constructor() {
        this.state = {
            isListening: false,
            isProcessingResponse: false,
            isSupported: true // Gemini Live API is supported
        };
        
        this.callbacks = {
            transcription: null,
            interim: null
        };
        
        this.screenRecorder = new ScreenRecorder();
        this.geminiService = new GeminiLiveStreamingService();
        this.voiceStartTime = null;
        this.voiceEndTime = null;
        this.inactivityTimer = null;
        this.INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutes
        
        // Set up callback for when screen sharing ends
        this.screenRecorder.onScreenSharingEnded = () => {
            this.handleScreenSharingEnded();
        };

        this.setupGeminiCallbacks();
        this.initializeGemini();
    }

    async initializeGemini() {
        try {
            const result = await this.geminiService.initialize();
            if (result.success) {
                console.log('Gemini Live API initialized successfully');
            } else {
                console.error('Gemini initialization failed:', result.error);
            }
        } catch (error) {
            console.error('Error initializing Gemini:', error);
        }
    }

    setupGeminiCallbacks() {
        // Handle user transcript
        this.geminiService.setUserTranscriptCallback((data) => {
            if (this.callbacks.transcription && data.final) {
                this.callbacks.transcription(data.text);
            } else if (this.callbacks.interim && !data.final) {
                this.callbacks.interim(data.text);
            }
        });
        
        // Handle bot response
        this.geminiService.setBotResponseCallback((data) => {
            if (data.text) {
                this.handleBotResponse(data.text);
            }
        });
        
        // Handle connection state changes
        this.geminiService.setConnectionStateCallback((state) => {
            console.log('Gemini connection state:', state);
            this.updateConnectionUI(state);
        });
        
        // Handle errors
        this.geminiService.setErrorCallback((error) => {
            console.error('Gemini error:', error);
            this.handleStreamingError(error);
        });
    }

    async startListening() {
        if (this.state.isListening) {
            console.log('Already listening');
            return { success: false, error: 'Already listening' };
        }

        try {
            this.voiceStartTime = Date.now();
            this.resetInactivityTimer();
            
            // Start Gemini streaming
            const result = await this.geminiService.startStreaming();
            
            if (result.success) {
                this.state.isListening = true;
                console.log('Started listening with Gemini Live API');
                
                // Also start local speech recognition for UI feedback
                this.startLocalSpeechRecognition();
                
                // Update UI to show listening state
                const voiceButton = document.getElementById('voiceButton');
                if (voiceButton) {
                    voiceButton.classList.add('listening');
                }
                
                // Update screen recording indicator
                this.updateScreenRecordingIndicator(true);
                
                return { success: true, message: 'Started listening with Gemini Live API' };
            } else {
                throw new Error(result.error || 'Failed to start streaming');
            }
            
        } catch (error) {
            console.error('Error starting Gemini streaming:', error);
            this.handleStreamingError(error);
            return { success: false, error: error.message };
        }
    }

    async stopListening() {
        if (!this.state.isListening) {
            return { success: false, error: 'Not currently listening' };
        }

        try {
            this.voiceEndTime = Date.now();
            
            // Stop local speech recognition
            if (this.speechRecognition) {
                this.speechRecognition.stop();
                this.speechRecognition = null;
            }
            
            // Stop Gemini streaming
            await this.geminiService.stopStreaming();
            
            this.state.isListening = false;
            console.log('Stopped listening');
            
            // Update UI
            const voiceButton = document.getElementById('voiceButton');
            if (voiceButton) {
                voiceButton.classList.remove('listening');
            }
            
            // Update screen recording indicator
            this.updateScreenRecordingIndicator(false);
            
            // Clear inactivity timer
            this.clearInactivityTimer();
            
            return { success: true, message: 'Stopped listening' };
            
        } catch (error) {
            console.error('Error stopping Gemini streaming:', error);
            this.state.isListening = false;
            return { success: false, error: error.message };
        }
    }

    handleBotResponse(text) {
        // Display bot response in chat
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            const botMessage = document.createElement('div');
            botMessage.className = 'message bot-message';
            botMessage.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${this.formatMessage(text)}</div>
                </div>
            `;
            messagesContainer.appendChild(botMessage);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Play audio response if available
        this.playBotAudio(text);
    }

    formatMessage(text) {
        // Basic markdown formatting
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    async playBotAudio(text) {
        // Use Web Speech API for text-to-speech
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;
            
            // Use a natural voice if available
            const voices = speechSynthesis.getVoices();
            const preferredVoice = voices.find(voice => 
                voice.name.includes('Google') || 
                voice.name.includes('Natural') ||
                voice.name.includes('Enhanced')
            );
            
            if (preferredVoice) {
                utterance.voice = preferredVoice;
            }
            
            speechSynthesis.speak(utterance);
        }
    }

    handleStreamingError(error) {
        console.error('Streaming error:', error);
        
        // Show error message to user
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            const errorMessage = document.createElement('div');
            errorMessage.className = 'message error-message';
            errorMessage.innerHTML = `
                <div class="message-content">
                    <div class="message-text">⚠️ ${error.message || 'Connection error occurred'}</div>
                </div>
            `;
            messagesContainer.appendChild(errorMessage);
        }
        
        // Reset UI state
        this.stopListening();
    }

    updateConnectionUI(state) {
        const headerStatus = document.getElementById('headerStatus');
        if (headerStatus) {
            if (state === 'connected') {
                headerStatus.textContent = '🟢 Connected to Gemini';
                headerStatus.classList.remove('hidden');
            } else if (state === 'disconnected') {
                headerStatus.textContent = '🔴 Disconnected';
                headerStatus.classList.remove('hidden');
                setTimeout(() => {
                    headerStatus.classList.add('hidden');
                }, 3000);
            }
        }
    }

    updateScreenRecordingIndicator(isRecording) {
        const indicator = document.getElementById('screenRecordingIndicator');
        if (indicator) {
            if (isRecording) {
                indicator.classList.remove('hidden');
            } else {
                indicator.classList.add('hidden');
            }
        }
    }

    handleScreenSharingEnded() {
        console.log('Screen sharing ended by user');
        this.updateScreenRecordingIndicator(false);
        
        // Notify user
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            const infoMessage = document.createElement('div');
            infoMessage.className = 'message system-message';
            infoMessage.innerHTML = `
                <div class="message-content">
                    <div class="message-text">ℹ️ Screen sharing stopped. I can still hear you but cannot see your screen.</div>
                </div>
            `;
            messagesContainer.appendChild(infoMessage);
        }
    }

    resetInactivityTimer() {
        this.clearInactivityTimer();
        
        this.inactivityTimer = setTimeout(() => {
            console.log('Inactivity timeout - stopping listening');
            this.stopListening();
            
            // Show timeout message
            const messagesContainer = document.getElementById('messages');
            if (messagesContainer) {
                const timeoutMessage = document.createElement('div');
                timeoutMessage.className = 'message system-message';
                timeoutMessage.innerHTML = `
                    <div class="message-content">
                        <div class="message-text">⏱️ Session timed out due to inactivity</div>
                    </div>
                `;
                messagesContainer.appendChild(timeoutMessage);
            }
        }, this.INACTIVITY_TIMEOUT);
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
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
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;

                if (isFinal) {
                    // Show final transcription in UI only
                    if (this.callbacks.transcription) {
                        this.callbacks.transcription(transcript);
                    }
                    // Don't send text to Gemini - let it use audio/video only
                } else {
                    // Show interim transcription
                    if (this.callbacks.interim) {
                        this.callbacks.interim(transcript);
                    }
                }
            }
        };

        this.speechRecognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };

        this.speechRecognition.start();
        console.log('Local speech recognition started');
    }

    // Setters for callbacks
    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    // Getters
    isListening() {
        return this.state.isListening;
    }

    isSupported() {
        return this.state.isSupported;
    }

    isProcessingResponse() {
        return this.state.isProcessingResponse;
    }

    getStatus() {
        return this.geminiService.getConnectionStatus();
    }

    cleanup() {
        this.clearInactivityTimer();
        this.geminiService.cleanup();
        this.screenRecorder.cleanup();
    }
}