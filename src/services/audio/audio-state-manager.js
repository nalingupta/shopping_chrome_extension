export class AudioStateManager {
    constructor() {
        this.state = {
            isListening: false,
        };

        this.callbacks = {
            transcription: null,
            interim: null,
            botResponse: null,
            status: null,
            listeningStopped: null,
        };

        this.cleanupTimer = null;
    }

    setTranscriptionCallback(callback) {
        this.callbacks.transcription = callback;
    }

    setInterimCallback(callback) {
        this.callbacks.interim = callback;
    }

    setBotResponseCallback(callback) {
        this.callbacks.botResponse = callback;
    }

    setStatusCallback(callback) {
        this.callbacks.status = callback;
    }

    setListeningStoppedCallback(callback) {
        this.callbacks.listeningStopped = callback;
    }

    isListening() {
        return this.state.isListening;
    }

    setListeningState(isListening) {
        this.state.isListening = isListening;
    }

    getCallbacks() {
        return this.callbacks;
    }

    getState() {
        return this.state;
    }

    startPeriodicCleanup(cleanupFunction) {
        this.stopPeriodicCleanup();

        this.cleanupTimer = setInterval(async () => {
            if (this.state.isListening) {
                try {
                    await cleanupFunction();
                } catch (error) {
                    console.error("Error during periodic cleanup:", error);
                }
            }
        }, 30000);
    }

    stopPeriodicCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    resetInactivityTimer(inactivityFunction) {
        this.clearInactivityTimer();

        this.inactivityTimer = setTimeout(() => {
            inactivityFunction();
        }, 20 * 60 * 1000);
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }
}
