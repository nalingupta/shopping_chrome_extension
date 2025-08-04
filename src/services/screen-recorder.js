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
    }

    async startRecording() {
        if (this.isRecording) {
            console.warn('Screen recording already in progress');
            return false;
        }

        try {
            // Use existing screen stream (should already be available)
            if (!this.screenStream || !this.isStreamActive(this.screenStream)) {
                console.error('Screen stream not available - should have been prepared during voice recognition start');
                throw new Error('Screen stream not available');
            } else {
                console.log('Using pre-authorized screen stream for recording');
            }

            // Get audio stream
            const audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            // Combine screen video and audio streams immediately
            const combinedStream = new MediaStream([
                ...this.screenStream.getVideoTracks(),
                ...audioStream.getAudioTracks()
            ]);
            
            console.log('Combined stream created with tracks:', combinedStream.getTracks().length);
            console.log('Video tracks:', combinedStream.getVideoTracks().length);
            console.log('Audio tracks:', combinedStream.getAudioTracks().length);
            
            // Record the combined stream directly
            this.mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: 'video/webm; codecs=vp8,opus'
            });
            
            this.audioChunks = []; // Will store video+audio chunks
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    console.log('Recorded chunk size:', event.data.size);
                }
            };
            
            this.mediaRecorder.start(1000); // Collect data every second
            
            // Reset counters - we don't need screenshots anymore since we're recording video directly
            this.screenshots = [];
            this.screenshotCount = 0;
            this.recordingStartTime = Date.now();
            this.isRecording = true;
            
            console.log('Combined audio/video recording started');
            return true;
            
        } catch (error) {
            console.error('Failed to start screen recording:', error);
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
        console.log('📝 Handling screen sharing termination...');
        
        // Clean up the ended stream
        this.screenStream = null;
        this.hasScreenPermission = false;
        
        // If we're currently recording, stop it gracefully
        if (this.isRecording) {
            console.warn('⚠️ Recording was active when sharing stopped - stopping recording');
            this.stopRecording().then(() => {
                console.log('Recording stopped due to screen sharing termination');
            }).catch(error => {
                console.error('Error stopping recording after sharing ended:', error);
            });
        }
        
        // Set flag to re-request permission on next recording attempt
        this.needsPermissionReRequest = true;
        
        console.log('💡 Screen permission will be re-requested on next voice input');
    }

    async requestScreenPermissionIfNeeded() {
        if (this.needsPermissionReRequest || !this.hasScreenPermission || !this.isStreamActive(this.screenStream)) {
            console.log('🔄 Re-requesting screen permission...');
            
            try {
                this.screenStream = await this.getScreenStream();
                if (this.screenStream) {
                    this.hasScreenPermission = true;
                    this.needsPermissionReRequest = false;
                    console.log('✅ Screen permission re-granted successfully');
                    return true;
                } else {
                    console.error('❌ Failed to re-acquire screen permission');
                    return false;
                }
            } catch (error) {
                console.error('Error re-requesting screen permission:', error);
                return false;
            }
        }
        return true; // Permission already available
    }

    async getScreenStream() {
        try {
            // Only request permission if not already requested in this session
            if (!this.permissionRequested) {
                this.permissionRequested = true;
                console.log('Requesting screen capture permission...');
            } else {
                console.log('Using previously granted screen permission...');
            }

            // Simplified screen capture - get stream once and reuse
            if (chrome && chrome.desktopCapture) {
                return new Promise((resolve, reject) => {
                    chrome.desktopCapture.chooseDesktopMedia(['screen'], async (streamId) => {
                        if (streamId) {
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    video: {
                                        mandatory: {
                                            chromeMediaSource: 'desktop',
                                            chromeMediaSourceId: streamId,
                                            maxWidth: 1280,
                                            maxHeight: 720
                                        }
                                    }
                                });
                                
                                // Set up stream end listener for when user clicks "Stop sharing"
                                stream.getVideoTracks()[0].addEventListener('ended', () => {
                                    console.warn('🛑 User stopped screen sharing via Chrome notification');
                                    this.handleScreenSharingEnded();
                                });
                                
                                resolve(stream);
                            } catch (error) {
                                reject(error);
                            }
                        } else {
                            reject(new Error('Screen capture cancelled'));
                        }
                    });
                });
            } else {
                const stream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        width: { ideal: 1280, max: 1280 },
                        height: { ideal: 720, max: 720 },
                        frameRate: { ideal: 1, max: 1 }
                    }
                });
                
                // Set up stream end listener for when user clicks "Stop sharing"
                stream.getVideoTracks()[0].addEventListener('ended', () => {
                    console.warn('🛑 User stopped screen sharing via Chrome notification');
                    this.handleScreenSharingEnded();
                });
                
                return stream;
            }
        } catch (error) {
            console.error('Failed to get screen stream:', error);
            this.hasScreenPermission = false;
            return null;
        }
    }

    captureScreenshotSafely() {
        // Safety checks
        if (!this.isRecording || !this.screenStream) {
            return;
        }

        try {
            this.screenshotCount++;
            
            // Create video element to capture frame from existing stream
            const video = document.createElement('video');
            video.srcObject = this.screenStream;
            video.muted = true;
            
            video.onloadedmetadata = () => {
                try {
                    // Create canvas for frame capture
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.min(video.videoWidth, 1280);
                    canvas.height = Math.min(video.videoHeight, 720);
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    
                    // Convert to blob with lower quality to save memory
                    canvas.toBlob((blob) => {
                        if (blob && this.isRecording) {
                            this.screenshots.push({
                                timestamp: Date.now(),
                                blob: blob,
                                relativeTime: Date.now() - this.recordingStartTime
                            });
                        }
                        
                        // Clean up
                        video.srcObject = null;
                        canvas.remove();
                    }, 'image/jpeg', 0.6);
                    
                } catch (error) {
                    console.error('Failed to capture frame:', error);
                    video.srcObject = null;
                }
            };
            
            video.play();
            
            // Cleanup after timeout
            setTimeout(() => {
                if (video.srcObject) {
                    video.srcObject = null;
                }
            }, 2000);
            
        } catch (error) {
            console.error('Failed to capture screenshot safely:', error);
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.warn('No screen recording in progress');
            return null;
        }
        
        this.recordingEndTime = Date.now();
        this.isRecording = false;
        
        console.log('Stopping combined audio/video recording...');
        
        // Stop the MediaRecorder
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            return new Promise((resolve) => {
                this.mediaRecorder.onstop = async () => {
                    console.log('MediaRecorder stopped, processing data...');
                    const recordingData = await this.processRecording();
                    this.cleanup();
                    resolve(recordingData);
                };
                this.mediaRecorder.stop();
            });
        } else {
            const recordingData = await this.processRecording();
            this.cleanup();
            return recordingData;
        }
    }

    async processRecording() {
        if (this.audioChunks.length === 0) {
            console.warn('No recording data captured');
            return null;
        }
        
        // Create video blob (contains both audio and video)
        const videoBlob = new Blob(this.audioChunks, { type: 'video/webm' });
        
        // Calculate recording duration
        const duration = this.recordingEndTime - this.recordingStartTime;
        
        console.log(`Recording processed: ${this.audioChunks.length} chunks, ${videoBlob.size} bytes, ${duration}ms duration`);
        
        return {
            videoBlob: videoBlob, // This is the final video with audio
            duration: duration,
            startTime: this.recordingStartTime,
            endTime: this.recordingEndTime,
            hasAudio: true
        };
    }

    async createVideo(recordingData) {
        if (!recordingData || !recordingData.videoBlob) {
            throw new Error('No recording data available');
        }
        
        console.log(`Video already created with audio: ${recordingData.hasAudio ? 'YES' : 'NO'}, size: ${recordingData.videoBlob.size} bytes`);
        
        // The video is already created with audio included
        return recordingData.videoBlob;
    }

    async recordCanvasToVideo(canvas, ctx, screenshots, audioBlob) {
        return new Promise(async (resolve, reject) => {
            try {
                const videoChunks = [];
                let audioUrl = null;
                
                // Create canvas stream for video
                const canvasStream = canvas.captureStream(1); // 1 FPS
                
                // Create audio stream from recorded audio blob
                let combinedStream = canvasStream;
                
                if (audioBlob && audioBlob.size > 0) {
                    console.log('Adding audio to video...');
                    // Create audio element and get its stream
                    audioUrl = URL.createObjectURL(audioBlob);
                    const audio = new Audio(audioUrl);
                    audio.muted = false;
                    
                    // Wait for audio to load
                    await new Promise((resolve) => {
                        audio.onloadeddata = resolve;
                        audio.onerror = () => {
                            console.error('Failed to load audio');
                            resolve(); // Continue without audio
                        };
                    });
                    
                    // Get audio stream
                    const audioStream = audio.captureStream();
                    
                    // Combine video and audio streams
                    combinedStream = new MediaStream([
                        ...canvasStream.getVideoTracks(),
                        ...audioStream.getAudioTracks()
                    ]);
                    
                    console.log('Combined stream tracks:', combinedStream.getTracks().length);
                    
                    // Play audio during recording
                    audio.currentTime = 0;
                    audio.play();
                }
                
                // Create video recorder with combined stream
                const videoRecorder = new MediaRecorder(combinedStream, {
                    mimeType: 'video/webm; codecs=vp8,opus'
                });
                
                videoRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        videoChunks.push(event.data);
                    }
                };
                
                videoRecorder.onstop = () => {
                    const videoBlob = new Blob(videoChunks, { type: 'video/webm' });
                    
                    // Clean up audio URL if it was created
                    if (audioUrl) {
                        URL.revokeObjectURL(audioUrl);
                    }
                    
                    resolve(videoBlob);
                };
                
                videoRecorder.onerror = (error) => {
                    reject(error);
                };
                
                videoRecorder.start();
                
                // Draw screenshots to canvas sequentially
                this.drawScreenshotsSequentially(ctx, screenshots, 0, () => {
                    videoRecorder.stop();
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }

    async drawScreenshotsSequentially(ctx, screenshots, index, onComplete) {
        if (index >= screenshots.length) {
            onComplete();
            return;
        }
        
        try {
            const screenshot = screenshots[index];
            const image = await this.blobToImage(screenshot.blob);
            
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
            
            // Wait 1 second (1 FPS) before next frame
            setTimeout(() => {
                this.drawScreenshotsSequentially(ctx, screenshots, index + 1, onComplete);
            }, 1000);
            
        } catch (error) {
            console.error('Error drawing screenshot:', error);
            // Continue with next screenshot
            setTimeout(() => {
                this.drawScreenshotsSequentially(ctx, screenshots, index + 1, onComplete);
            }, 1000);
        }
    }

    blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    cleanup(destroyScreenStream = false) {
        // Stop screenshot interval
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
        
        // Stop and cleanup media recorder (but keep audio tracks available for next recording)
        if (this.mediaRecorder) {
            try {
                if (this.mediaRecorder.state !== 'inactive') {
                    this.mediaRecorder.stop();
                }
                // Stop the combined stream tracks, but not the original screen stream
                if (this.mediaRecorder.stream) {
                    this.mediaRecorder.stream.getTracks().forEach(track => {
                        // Only stop audio tracks, not the persistent screen video track
                        if (track.kind === 'audio') {
                            track.stop();
                        }
                    });
                }
            } catch (error) {
                console.error('Error stopping media recorder:', error);
            }
            this.mediaRecorder = null;
        }
        
        // NEVER destroy screen stream during normal cleanup - keep it persistent
        if (destroyScreenStream && this.screenStream) {
            try {
                this.screenStream.getTracks().forEach(track => {
                    track.stop();
                });
                console.log('🔴 Screen stream explicitly destroyed');
            } catch (error) {
                console.error('Error stopping screen stream:', error);
            }
            this.screenStream = null;
            this.hasScreenPermission = false;
            this.permissionRequested = false;
        } else if (this.screenStream) {
            console.log('🟢 Screen stream preserved for future recordings');
        }
        
        // Clear recording data and reset state
        this.screenshots = [];
        this.audioChunks = [];
        this.screenshotCount = 0;
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordingEndTime = null;
        
        console.log(`Screen recorder cleanup completed ${destroyScreenStream ? '(screen permission destroyed)' : '(screen permission preserved)'}`);
    }

    // Method to explicitly destroy screen stream when no longer needed
    destroyScreenStream() {
        this.cleanup(true);
    }

    downloadVideo(videoBlob, filename = 'screen-recording.webm') {
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}