import { API_CONFIG } from "../config/api-keys.js";

export class ServerWsClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.seq = 0;
        this.callbacks = {
            onBotResponse: null,
            onStatus: null,
            onError: null,
            onConnectionStateChange: null,
        };
        this.sessionStartMs = null;
    }

    setBotResponseCallback(cb) {
        this.callbacks.onBotResponse = cb;
    }
    setStatusCallback(cb) {
        this.callbacks.onStatus = cb;
    }
    setErrorCallback(cb) {
        this.callbacks.onError = cb;
    }
    setConnectionStateCallback(cb) {
        this.callbacks.onConnectionStateChange = cb;
    }

    getConnectionStatus() {
        return { isConnected: this.isConnected };
    }

    async connect({ fps = 10, sampleRate = 16000 } = {}) {
        if (this.isConnected) return { success: true };
        return new Promise((resolve) => {
            try {
                const url = API_CONFIG.SERVER_WS_URL;
                this.ws = new WebSocket(url);
                this.ws.onopen = () => {
                    this.isConnected = true;
                    this.sessionStartMs = performance.now();
                    this.#emitConnectionState("connected");
                    this.#send({
                        type: "init",
                        sessionId: this.#uuid(),
                        fps,
                        sampleRate,
                        seq: this.#nextSeq(),
                    });
                    resolve({ success: true });
                };
                this.ws.onmessage = (evt) => this.#handleMessage(evt);
                this.ws.onerror = (err) => this.#emitError(err);
                this.ws.onclose = () => {
                    this.isConnected = false;
                    this.#emitConnectionState("disconnected");
                };
            } catch (error) {
                this.#emitError(error);
                resolve({
                    success: false,
                    error: String(error?.message || error),
                });
            }
        });
    }

    async disconnect() {
        try {
            if (this.ws) this.ws.close();
            this.isConnected = false;
            this.#emitConnectionState("disconnected");
            return { success: true };
        } catch (error) {
            this.#emitError(error);
            return { success: false, error: String(error?.message || error) };
        }
    }

    sendImageFrame(base64Jpeg, tsMs) {
        if (!this.isConnected) return;
        this.#send({
            type: "imageFrame",
            seq: this.#nextSeq(),
            tsMs,
            mime: "image/jpeg",
            base64: base64Jpeg,
        });
    }

    sendAudioPcm(base64Pcm, tsStartMs, numSamples, sampleRate = 16000) {
        if (!this.isConnected) return;
        this.#send({
            type: "audioChunk",
            seq: this.#nextSeq(),
            tsStartMs,
            numSamples,
            sampleRate,
            mime: "audio/pcm",
            base64: base64Pcm,
        });
    }

    sendTranscript(text, tsMs, isFinal = true) {
        if (!this.isConnected) return;
        this.#send({
            type: "transcript",
            seq: this.#nextSeq(),
            tsMs,
            isFinal: !!isFinal,
            text,
        });
    }

    sendTextMessage(text) {
        if (!this.isConnected) return;
        this.#send({
            type: "text",
            seq: this.#nextSeq(),
            tsMs: Date.now(),
            text,
        });
    }

    // Internal
    #handleMessage(evt) {
        try {
            const data = JSON.parse(evt.data);
            const t = data?.type;
            if (t === "status") {
                this.callbacks.onStatus?.(data);
            } else if (t === "response") {
                this.callbacks.onBotResponse?.({
                    text: data.text,
                    timestamp: Date.now(),
                    isStreaming: false,
                });
            } else if (t === "error") {
                this.callbacks.onError?.(
                    new Error(data?.message || "server error")
                );
            }
        } catch (error) {
            this.#emitError(error);
        }
    }

    #send(obj) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
            }
        } catch (error) {
            this.#emitError(error);
        }
    }

    #emitError(err) {
        this.callbacks.onError?.(err);
    }
    #emitConnectionState(state) {
        this.callbacks.onConnectionStateChange?.(state);
    }
    #nextSeq() {
        this.seq += 1;
        return this.seq;
    }
    #uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}
