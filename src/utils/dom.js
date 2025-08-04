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
        // Create modal overlay
        const modal = DOMUtils.createElement('div', 'video-modal');
        
        const modalContent = DOMUtils.createElement('div', 'video-modal-content');
        
        // Close button
        const closeButton = DOMUtils.createElement('button', 'video-modal-close');
        closeButton.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        
        // Full-size video
        const video = document.createElement('video');
        video.className = 'video-modal-player';
        video.src = videoData.url;
        video.controls = true;
        video.autoplay = true;
        
        modalContent.appendChild(closeButton);
        modalContent.appendChild(video);
        modal.appendChild(modalContent);
        
        // Close handlers
        const closeModal = () => {
            video.pause();
            modal.remove();
        };
        
        closeButton.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
        
        document.body.appendChild(modal);
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