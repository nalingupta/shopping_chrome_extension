export class MessageRenderer {
    static createMessage(content, type, isLoading = false, videoData = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = `message-content ${isLoading ? 'loading' : ''}`;
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        
        // Add video thumbnail if video data is provided
        if (videoData && type === 'user') {
            const videoContainer = this.createVideoThumbnail(videoData);
            messageDiv.appendChild(videoContainer);
        }
        
        return messageDiv;
    }

    static createVideoThumbnail(videoData) {
        const container = document.createElement('div');
        container.className = 'video-thumbnail-container';
        
        const thumbnail = document.createElement('video');
        thumbnail.className = 'video-thumbnail';
        thumbnail.src = videoData.url;
        thumbnail.muted = true;
        thumbnail.preload = 'metadata';
        
        // Create overlay with play button and duration
        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        
        const playButton = document.createElement('div');
        playButton.className = 'video-play-button';
        playButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
        
        const duration = document.createElement('div');
        duration.className = 'video-duration';
        duration.textContent = this.formatDuration(videoData.duration);
        
        overlay.appendChild(playButton);
        overlay.appendChild(duration);
        
        container.appendChild(thumbnail);
        container.appendChild(overlay);
        
        // Add click handler to expand video
        container.addEventListener('click', () => {
            this.expandVideo(videoData);
        });
        
        return container;
    }

    static formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    static expandVideo(videoData) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'video-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        
        // Full-size video
        const video = document.createElement('video');
        video.className = 'video-modal-player';
        video.src = videoData.url;
        video.controls = true;
        video.autoplay = false;
        video.muted = false;
        video.volume = 1.0;
        video.preload = 'metadata';
        video.disablePictureInPicture = false;
        
        video.setAttribute('allowfullscreen', '');
        video.setAttribute('webkitallowfullscreen', '');
        video.setAttribute('mozallowfullscreen', '');
        
        modal.appendChild(video);
        
        // Close handlers
        const closeModal = () => {
            video.pause();
            document.body.style.overflow = '';
            document.removeEventListener('keydown', escHandler);
            modal.remove();
        };
        
        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
        
        // Escape key handler
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
        
        document.body.appendChild(modal);
        
        // Ensure video is unmuted when loaded
        video.addEventListener('loadedmetadata', () => {
            video.muted = false;
            video.volume = 1.0;
        });
        
        video.addEventListener('error', (e) => {
            console.error('Video failed to load:', e);
        });
    }

    static createInterimMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message interim-message';
        messageDiv.id = 'interim-message';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content interim-content';
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        
        return messageDiv;
    }

    static updateInterimMessage(content) {
        const interimMessage = document.getElementById('interim-message');
        if (interimMessage) {
            const contentDiv = interimMessage.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.textContent = content;
            }
        }
    }

    static clearInterimMessage() {
        const interimMessage = document.getElementById('interim-message');
        if (interimMessage) {
            interimMessage.remove();
        }
    }
}