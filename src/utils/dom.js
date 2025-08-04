// DOM utility functions
export class DOMUtils {
    static createElement(tag, className, textContent) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    static getElementById(id) {
        const element = document.getElementById(id);
        if (!element) {
        }
        return element;
    }

    static querySelector(selector) {
        const element = document.querySelector(selector);
        if (!element) {
        }
        return element;
    }

    static removeElement(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }

    static scrollToBottom(container) {
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    static adjustTextareaHeight(textarea, maxHeight = 80) {
        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
        }
    }
}

export class MessageRenderer {
    static createMessage(content, type, isLoading = false, videoData = null) {
        const messageDiv = DOMUtils.createElement('div', `message ${type}-message`);
        const contentDiv = DOMUtils.createElement('div', 
            `message-content ${isLoading ? 'loading' : ''}`, 
            content
        );
        
        messageDiv.appendChild(contentDiv);
        
        // Add video thumbnail if video data is provided
        if (videoData && type === 'user') {
            const videoContainer = this.createVideoThumbnail(videoData);
            messageDiv.appendChild(videoContainer);
        }
        
        return messageDiv;
    }


    static createVideoThumbnail(videoData) {
        const container = DOMUtils.createElement('div', 'video-thumbnail-container');
        
        const thumbnail = document.createElement('video');
        thumbnail.className = 'video-thumbnail';
        thumbnail.src = videoData.url;
        thumbnail.muted = true;
        thumbnail.preload = 'metadata';
        
        // Create overlay with play button and duration
        const overlay = DOMUtils.createElement('div', 'video-overlay');
        
        const playButton = DOMUtils.createElement('div', 'video-play-button');
        playButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
        
        const duration = DOMUtils.createElement('div', 'video-duration', 
            this.formatDuration(videoData.duration));
        
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
        // Create simple modal overlay
        const modal = DOMUtils.createElement('div', 'video-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        
        // Full-size video - no wrapper div
        const video = document.createElement('video');
        video.className = 'video-modal-player';
        video.src = videoData.url;
        video.controls = true;
        video.autoplay = false;
        video.muted = false; // Ensure sound is enabled by default
        video.volume = 1.0; // Full volume
        video.preload = 'metadata';
        video.disablePictureInPicture = false; // Allow picture-in-picture
        
        // Enable fullscreen capability - the browser's video controls will handle fullscreen
        video.setAttribute('allowfullscreen', '');
        video.setAttribute('webkitallowfullscreen', '');
        video.setAttribute('mozallowfullscreen', '');
        
        modal.appendChild(video);
        
        // Close handlers
        const closeModal = () => {
            video.pause();
            document.body.style.overflow = ''; // Restore body scroll
            document.removeEventListener('keydown', escHandler);
            modal.remove();
        };
        
        // Click anywhere outside video to close
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
        
        // Add to body
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
        const messageDiv = DOMUtils.createElement('div', 'message user-message interim-message');
        messageDiv.id = 'interim-message';
        
        const contentDiv = DOMUtils.createElement('div', 'message-content interim-content', content);
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