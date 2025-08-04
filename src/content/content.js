import { MESSAGE_TYPES } from '../utils/constants.js';
import { PageAnalyzer } from '../services/page-analyzer.js';

class ContentScript {
    constructor() {
        this.currentUrl = window.location.href;
        this.currentDomain = window.location.hostname;
        
        this.initialize();
    }

    initialize() {
        this.sendPageInfoToSidebar();
        this.setupEventListeners();
        this.observeUrlChanges();
    }

    sendPageInfoToSidebar() {
        const pageInfo = PageAnalyzer.getCompletePageInfo();
        
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.PAGE_INFO_UPDATE,
            data: pageInfo
        });
    }

    setupEventListeners() {
        window.addEventListener('load', () => {
            this.sendPageInfoToSidebar();
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === MESSAGE_TYPES.GET_PAGE_INFO) {
                const pageInfo = PageAnalyzer.getCompletePageInfo();
                sendResponse(pageInfo);
            }
            
            if (request.type === MESSAGE_TYPES.REQUEST_MIC_PERMISSION) {
                this.handleMicrophoneRequest(sendResponse);
                return true;
            }
        });
    }

    observeUrlChanges() {
        let lastUrl = this.currentUrl;
        
        const observer = new MutationObserver(() => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                this.currentUrl = lastUrl;
                this.currentDomain = window.location.hostname;
                
                setTimeout(() => {
                    this.sendPageInfoToSidebar();
                }, 1000);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    async handleMicrophoneRequest(sendResponse) {
        try {
            if (!window.isSecureContext) {
                sendResponse({
                    success: false,
                    error: 'not_secure_context',
                    details: 'Microphone access requires a secure context (HTTPS)'
                });
                return;
            }
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                sendResponse({
                    success: false,
                    error: 'getusermedia_not_supported',
                    details: 'getUserMedia API not supported in this context'
                });
                return;
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
                ? 'audio/webm' 
                : 'audio/ogg';
            
            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            const audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.AUDIO_RECORDED,
                    audioBlob: audioBlob
                });
            };
            
            mediaRecorder.start();
            
            window.voiceRecorder = {
                mediaRecorder: mediaRecorder,
                stream: stream,
                audioChunks: audioChunks
            };
            
            sendResponse({
                success: true,
                message: 'Recording started'
            });
            
        } catch (error) {
            
            const errorType = this.getErrorType(error);
            
            sendResponse({
                success: false,
                error: errorType,
                details: error.message
            });
        }
    }

    getErrorType(error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            return 'permission_denied';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            return 'no_microphone';
        } else if (error.name === 'NotSupportedError') {
            return 'not_supported';
        }
        return 'unknown';
    }
}

// Initialize the content script
new ContentScript();