export class UIState {
    constructor() {
        this.isProcessing = false;
        this.statusTimer = null;
        this.headerStatus = document.getElementById('headerStatus');
        this.speechState = 'idle'; // idle, listening, processing, responding
        this.speechStateIndicator = null;
        this.initializeSpeechStateIndicator();
    }

    initializeSpeechStateIndicator() {
        // Create speech state indicator element
        this.speechStateIndicator = document.createElement('div');
        this.speechStateIndicator.className = 'speech-state-indicator hidden';
        this.speechStateIndicator.id = 'speechStateIndicator';
        
        // Add to voice container when DOM is ready
        setTimeout(() => {
            const voiceContainer = document.querySelector('.voice-container');
            if (voiceContainer && !document.getElementById('speechStateIndicator')) {
                voiceContainer.appendChild(this.speechStateIndicator);
            }
        }, 100);
    }


    setProcessing(processing) {
        this.isProcessing = processing;
    }

    showStatus(message, type = 'info', duration = null) {
        if (!this.headerStatus) return;

        this.clearStatus();

        this.headerStatus.textContent = message;
        this.headerStatus.className = `header-status ${type}`;
        
        if (duration) {
            this.statusTimer = setTimeout(() => {
                this.clearStatus();
            }, duration);
        }
    }

    showTemporaryStatus(message, type, duration) {
        this.showStatus(message, type, duration);
        
        setTimeout(() => {
            this.showStatus("Start a chat", "info");
        }, duration);
    }

    clearStatus() {
        if (!this.headerStatus) return;
        
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
            this.statusTimer = null;
        }
        
        this.headerStatus.className = 'header-status hidden';
        this.headerStatus.textContent = '';
    }

    setSpeechState(state) {
        this.speechState = state;
        this.updateSpeechStateIndicator();
    }

    updateSpeechStateIndicator() {
        if (!this.speechStateIndicator) {
            this.speechStateIndicator = document.getElementById('speechStateIndicator');
        }
        
        if (!this.speechStateIndicator) return;

        // Remove existing state classes
        this.speechStateIndicator.className = 'speech-state-indicator';
        
        // Add current state class
        this.speechStateIndicator.classList.add(this.speechState);
        
        // Set appropriate text and visibility
        switch (this.speechState) {
            case 'idle':
                this.speechStateIndicator.classList.add('hidden');
                this.speechStateIndicator.textContent = '';
                break;
            case 'listening':
                this.speechStateIndicator.classList.remove('hidden');
                this.speechStateIndicator.textContent = 'Listening...';
                break;
            case 'processing':
                this.speechStateIndicator.classList.remove('hidden');
                this.speechStateIndicator.textContent = 'Processing...';
                break;
            case 'responding':
                this.speechStateIndicator.classList.remove('hidden');
                this.speechStateIndicator.textContent = 'AI Responding...';
                break;
        }
    }

    getSpeechState() {
        return this.speechState;
    }
}