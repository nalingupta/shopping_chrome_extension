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
    static createMessage(content, type, isLoading = false) {
        const messageDiv = DOMUtils.createElement('div', `message ${type}-message`);
        const contentDiv = DOMUtils.createElement('div', 
            `message-content ${isLoading ? 'loading' : ''}`, 
            content
        );
        
        messageDiv.appendChild(contentDiv);
        return messageDiv;
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