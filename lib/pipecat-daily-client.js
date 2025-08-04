// Pipecat Daily.co WebRTC Client for Chrome Extension
// Uses Daily.co with avoidEval: true to prevent CSP violations

(function() {
    'use strict';
    
    class PipecatDailyClient {
        constructor(config) {
            this.config = config;
            this.connected = false;
            this.eventHandlers = {};
            this.dailyCallObject = null;
            this.localStream = null;
        }
        
        on(event, callback) {
            if (!this.eventHandlers[event]) {
                this.eventHandlers[event] = [];
            }
            this.eventHandlers[event].push(callback);
        }
        
        emit(event, data) {
            if (this.eventHandlers[event]) {
                this.eventHandlers[event].forEach(callback => callback(data));
            }
        }
        
        async join() {
            try {
                console.log('Connecting to Daily.co room with CSP-safe configuration...');
                
                // Check if Daily.co library is loaded
                if (typeof DailyIframe === 'undefined') {
                    throw new Error('Daily.co library not loaded');
                }
                
                // Create call object with CSP-safe configuration
                this.dailyCallObject = DailyIframe.createCallObject();
                
                // Set up Daily.co event handlers
                this.setupDailyHandlers();
                
                // Join with avoidEval to prevent CSP violations
                await this.dailyCallObject.join({
                    url: this.config.roomUrl,
                    token: this.config.token,
                    dailyConfig: {
                        avoidEval: true  // This prevents 'unsafe-eval' CSP violations
                    }
                });
                
                console.log('Successfully joined Daily.co room with CSP-safe config');
                
                this.connected = true;
                this.emit('connected');
                return Promise.resolve();
                
            } catch (error) {
                console.error('Daily.co connection failed:', error);
                this.emit('error', error);
                return Promise.reject(error);
            }
        }
        
        setupDailyHandlers() {
            // Handle joining meeting
            this.dailyCallObject.on('joined-meeting', () => {
                console.log('Joined Daily.co meeting for Pipecat streaming');
                this.emit('webrtc-connected');
            });
            
            // Handle participant events
            this.dailyCallObject.on('participant-joined', (event) => {
                console.log('Pipecat bot joined meeting:', event.participant);
                
                // Check if this is the Pipecat bot
                if (event.participant.user_name && 
                    event.participant.user_name.includes('pipecat')) {
                    this.emit('pipecat-bot-joined', event.participant);
                }
            });
            
            // Handle participant updates (like audio/video state changes)
            this.dailyCallObject.on('participant-updated', (event) => {
                if (event.participant.audio && event.participant.user_name &&
                    event.participant.user_name.includes('pipecat')) {
                    // Pipecat bot is speaking
                    this.emit('bot-audio', event.participant);
                }
            });
            
            // Handle app messages (data channel messages)
            this.dailyCallObject.on('app-message', (event) => {
                console.log('Received app message:', event);
                this.handleAppMessage(event);
            });
            
            // Handle errors
            this.dailyCallObject.on('error', (error) => {
                console.error('Daily.co error:', error);
                this.emit('error', error);
            });
            
            // Handle call state changes
            this.dailyCallObject.on('call-state-updated', (event) => {
                console.log('Call state updated:', event.state);
                
                if (event.state === 'left') {
                    this.connected = false;
                    this.emit('disconnected');
                }
            });
        }
        
        handleAppMessage(event) {
            try {
                const message = event.data;
                
                // Handle different message types from Pipecat
                switch (message.type) {
                    case 'bot-transcript':
                    case 'bot-response':
                        this.emit('botResponse', message.data);
                        break;
                        
                    case 'user-transcript':
                        this.emit('userTranscript', message.data);
                        break;
                        
                    case 'pipecat-response':
                        // Handle Pipecat AI responses
                        this.emit('botResponse', {
                            text: message.text || message.response,
                            timestamp: message.timestamp || Date.now()
                        });
                        break;
                        
                    default:
                        console.log('Unknown app message type:', message.type);
                }
            } catch (error) {
                console.error('Error handling app message:', error);
            }
        }
        
        async sendClientMessage(eventType, payload) {
            if (this.dailyCallObject && this.connected) {
                try {
                    const message = {
                        type: eventType,
                        data: payload,
                        timestamp: Date.now()
                    };
                    
                    // Send via Daily.co app messaging (data channel)
                    await this.dailyCallObject.sendAppMessage(message, '*');
                    
                    console.log('Sent app message to Pipecat:', eventType);
                    return Promise.resolve();
                } catch (error) {
                    console.error('Failed to send app message:', error);
                    return Promise.reject(error);
                }
            } else {
                return Promise.reject(new Error('Not connected to Daily.co room'));
            }
        }
        
        async setLocalMediaStream(stream) {
            try {
                this.localStream = stream;
                
                console.log('Setting local media stream on Daily.co call:', 
                    stream.getAudioTracks().length, 'audio,',
                    stream.getVideoTracks().length, 'video');
                
                // Enable/disable tracks based on what's available
                const hasAudio = stream.getAudioTracks().length > 0;
                const hasVideo = stream.getVideoTracks().length > 0;
                
                await this.dailyCallObject.setLocalAudio(hasAudio);
                await this.dailyCallObject.setLocalVideo(hasVideo);
                
                // Set the actual media stream
                if (hasAudio || hasVideo) {
                    await this.dailyCallObject.setInputDevicesAsync({
                        audio: hasAudio ? { mediaStream: stream } : false,
                        video: hasVideo ? { mediaStream: stream } : false
                    });
                }
                
                console.log('Successfully set local media stream on Daily.co');
                return Promise.resolve();
            } catch (error) {
                console.error('Failed to set local media stream:', error);
                return Promise.reject(error);
            }
        }
        
        addTrack(track, stream) {
            // Daily.co handles track management internally
            // This method is here for API compatibility
            console.log('Adding track to Daily.co (handled internally):', track.kind);
            return Promise.resolve();
        }
        
        disconnect() {
            this.connected = false;
            
            // Leave Daily.co meeting
            if (this.dailyCallObject) {
                try {
                    this.dailyCallObject.leave();
                    this.dailyCallObject.destroy();
                } catch (error) {
                    console.error('Error leaving Daily.co meeting:', error);
                }
                this.dailyCallObject = null;
            }
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            this.emit('disconnected');
            console.log('Disconnected from Daily.co room');
        }
        
        // Additional Daily.co specific methods
        async updateInputSettings(settings) {
            if (this.dailyCallObject) {
                try {
                    await this.dailyCallObject.updateInputSettings(settings);
                    console.log('Updated Daily.co input settings');
                } catch (error) {
                    console.error('Failed to update input settings:', error);
                    throw error;
                }
            }
        }
        
        async setLocalAudio(enabled) {
            if (this.dailyCallObject) {
                await this.dailyCallObject.setLocalAudio(enabled);
            }
        }
        
        async setLocalVideo(enabled) {
            if (this.dailyCallObject) {
                await this.dailyCallObject.setLocalVideo(enabled);
            }
        }
        
        // Get meeting state
        getMeetingState() {
            if (this.dailyCallObject) {
                return this.dailyCallObject.meetingState();
            }
            return 'new';
        }
        
        // Get participants
        getParticipants() {
            if (this.dailyCallObject) {
                return this.dailyCallObject.participants();
            }
            return {};
        }
    }
    
    // Make PipecatDailyClient available globally
    window.PipecatDailyClient = PipecatDailyClient;
    
})();