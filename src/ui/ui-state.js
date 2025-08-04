export class UIState {
    constructor() {
        this.isProcessing = false;
        this.debugMode = this.loadDebugMode();
        this.statusTimer = null;
        this.headerStatus = document.getElementById('headerStatus');
        this.debugToggle = document.getElementById('debugToggle');
        
        this.updateDebugToggle();
    }

    loadDebugMode() {
        try {
            const saved = localStorage.getItem('shoppingAssistant_debugMode');
            return saved ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    }

    saveDebugMode() {
        try {
            localStorage.setItem('shoppingAssistant_debugMode', JSON.stringify(this.debugMode));
        } catch {
            // Handle storage errors silently
        }
    }

    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        this.updateDebugToggle();
        this.saveDebugMode();
    }

    updateDebugToggle() {
        if (this.debugToggle) {
            if (this.debugMode) {
                this.debugToggle.classList.add('active');
            } else {
                this.debugToggle.classList.remove('active');
            }
        }
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
}