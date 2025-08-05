export class UIState {
    constructor() {
        this.isProcessing = false;
        this.statusTimer = null;
        this.headerStatus = document.getElementById('headerStatus');
        this.speechState = 'idle'; // idle, listening, processing, responding
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
    }

    getSpeechState() {
        return this.speechState;
    }
}