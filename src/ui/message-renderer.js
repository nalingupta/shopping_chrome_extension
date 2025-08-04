export class MessageRenderer {
    static createMessage(content, type, isLoading = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = `message-content ${isLoading ? 'loading' : ''}`;
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        
        return messageDiv;
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