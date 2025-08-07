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

    reset() {
        this.state.isListening = false;
    }
}
