export class ScreenCapture {
    constructor() {
        this.screenStream = null;
        this.hasPermission = false;
        this.onScreenSharingEnded = null;
    }

    async setup() {
        if (this.hasPermission && this.isStreamActive()) {
            return true;
        }

        try {
            this.screenStream = await this.getScreenStream();
            if (this.screenStream) {
                this.hasPermission = true;
                this.setupStreamEndListener();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Screen capture setup failed:', error);
            throw error;
        }
    }

    async getScreenStream() {
        try {
            const streamId = await new Promise((resolve, reject) => {
                chrome.desktopCapture.chooseDesktopMedia(
                    ['screen', 'window', 'tab'],
                    (streamId) => {
                        if (streamId) {
                            resolve(streamId);
                        } else {
                            reject(new Error('Screen capture permission denied'));
                        }
                    }
                );
            });
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: streamId,
                        maxWidth: 1920,
                        maxHeight: 1080,
                        maxFrameRate: 30
                    }
                }
            });
            
            return stream;
            
        } catch (error) {
            console.error('Failed to get screen stream:', error);
            throw error;
        }
    }

    setupStreamEndListener() {
        if (!this.screenStream) return;
        
        this.screenStream.getVideoTracks().forEach(track => {
            track.addEventListener('ended', () => {
                this.handleScreenSharingEnded();
            });
        });
    }

    handleScreenSharingEnded() {
        this.screenStream = null;
        this.hasPermission = false;
        
        if (this.onScreenSharingEnded) {
            this.onScreenSharingEnded();
        }
    }

    isStreamActive() {
        if (!this.screenStream) return false;
        const videoTracks = this.screenStream.getVideoTracks();
        return videoTracks.length > 0 && videoTracks[0].readyState === 'live';
    }

    hasStream() {
        return this.screenStream !== null && this.isStreamActive();
    }

    getStream() {
        return this.screenStream;
    }

    isActive() {
        return this.hasPermission && this.isStreamActive();
    }

    stop() {
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
            this.hasPermission = false;
        }
    }
}