export class ScreenRecorder {
    constructor() {
        this.isRecording = false;
        this.screenshots = [];
        this.audioChunks = [];
        this.mediaRecorder = null;
        this.screenshotInterval = null;
        this.recordingStartTime = null;
        this.recordingEndTime = null;
        this.screenStream = null;
        this.screenshotCount = 0;
        this.hasScreenPermission = false;
        this.permissionRequested = false;
        this.needsPermissionReRequest = false;
        this.onScreenSharingEnded = null; // Callback for when screen sharing ends
    }

    async startRecording() {
        if (this.isRecording) {
            console.log('📹 Already recording, returning false');
            return false;
        }

        try {
            if (!this.screenStream || !this.isStreamActive(this.screenStream)) {
                throw new Error('Screen stream not available');
            }

            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            const combinedStream = new MediaStream([
                ...this.screenStream.getVideoTracks(),
                ...audioStream.getAudioTracks()
            ]);
            
            this.mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: 'video/webm; codecs=vp8,opus'
            });
            
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.start(1000);
            
            this.screenshots = [];
            this.screenshotCount = 0;
            this.recordingStartTime = Date.now();
            this.isRecording = true;
            
            return true;
            
        } catch (error) {
            console.error('📹 Recording start failed:', error);
            this.cleanup();
            return false;
        }
    }

    isStreamActive(stream) {
        if (!stream) return false;
        const videoTracks = stream.getVideoTracks();
        return videoTracks.length > 0 && videoTracks[0].readyState === 'live';
    }

    handleScreenSharingEnded() {
        console.log('📹 Screen sharing ended - user clicked Stop Sharing or stream ended');
        this.screenStream = null;
        this.hasScreenPermission = false;
        
        if (this.isRecording) {
            this.stopRecording().catch(() => {
                // Handle silently - recording will be cleaned up
            });
        }
        
        this.needsPermissionReRequest = true;
        
        // Notify voice handler to stop voice input
        if (this.onScreenSharingEnded) {
            this.onScreenSharingEnded();
        }
    }

    async requestScreenPermissionIfNeeded() {
        console.log('📹 Checking screen permission...', {
            needsPermissionReRequest: this.needsPermissionReRequest,
            hasScreenPermission: this.hasScreenPermission,
            streamActive: this.isStreamActive(this.screenStream)
        });
        
        if (this.needsPermissionReRequest || !this.hasScreenPermission || !this.isStreamActive(this.screenStream)) {
            console.log('📹 Screen permission needed, requesting...');
            try {
                this.screenStream = await this.getScreenStream();
                if (this.screenStream) {
                    this.hasScreenPermission = true;
                    this.needsPermissionReRequest = false;
                    console.log('📹 Screen permission granted successfully');
                    return true;
                }
                return false;
            } catch (error) {
                console.error('📹 Error requesting screen permission:', error);
                return false;
            }
        }
        console.log('📹 Screen permission already available, no need to request');
        return true;
    }

    async getScreenStream() {
        try {
            console.log('📹 Requesting screen capture permission...');
            this.permissionRequested = true;
            
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen'],
                    (streamId) => {
                        if (streamId) {
                            resolve(streamId);
                        } else {
                            reject(new Error('User cancelled or denied screen capture permission'));
                        }
                    }
                );
            });

            console.log('📹 Creating screen stream with streamId using legacy constraints...');
            
            // Use the older constraint format that works with desktop capture
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: streamId,
                        maxWidth: 1280,
                        maxHeight: 720,
                        maxFrameRate: 30
                    }
                }
            });

            console.log('📹 Screen stream created successfully with desktop capture');
            this.setupStreamEndListener(stream);
            return stream;
            
        } catch (error) {
            console.error('📹 Failed to get screen stream:', error);
            this.permissionRequested = false;
            return null;
        }
    }

    setupStreamEndListener(stream) {
        if (!stream) return;
        
        stream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => {
                this.handleScreenSharingEnded();
            });
        });
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.log('📹 Not recording, returning null');
            return null;
        }
        
        console.log('📹 Stopping recording...');
        this.recordingEndTime = Date.now();
        this.isRecording = false;
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            console.log('📹 MediaRecorder is active, stopping...');
            return new Promise((resolve) => {
                this.mediaRecorder.onstop = async () => {
                    console.log('📹 MediaRecorder stopped, processing recording...');
                    const recordingData = await this.processRecording();
                    resolve(recordingData);
                };
                this.mediaRecorder.stop();
            });
        } else {
            console.log('📹 MediaRecorder already inactive, processing recording...');
            return await this.processRecording();
        }
    }

    async processRecording() {
        console.log('📹 Processing recording with', this.audioChunks.length, 'chunks');
        
        if (this.audioChunks.length === 0) {
            console.warn('📹 No recording chunks available');
            return null;
        }
        
        const videoBlob = new Blob(this.audioChunks, { type: 'video/webm' });
        const duration = this.recordingEndTime - this.recordingStartTime;
        
        console.log('📹 Created video blob:', videoBlob.size, 'bytes, duration:', duration, 'ms');
        
        return {
            videoBlob,
            duration,
            hasAudio: true,
            screenshots: this.screenshots
        };
    }

    async createVideo(recordingData) {
        if (!recordingData?.videoBlob) {
            throw new Error('No recording data available');
        }
        
        return recordingData.videoBlob;
    }

    downloadVideo(videoBlob, filename) {
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    cleanup(destroyScreenStream = false) {
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state !== 'inactive') {
                    this.mediaRecorder.stop();
                }
            } catch (error) {
                // Handle silently
            }
            this.mediaRecorder = null;
        }
        
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
        
        if (destroyScreenStream && this.screenStream) {
            try {
                this.screenStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                // Handle silently
            }
            this.screenStream = null;
            this.hasScreenPermission = false;
        }
        
        this.audioChunks = [];
        this.screenshots = [];
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordingEndTime = null;
        this.screenshotCount = 0;
    }
}