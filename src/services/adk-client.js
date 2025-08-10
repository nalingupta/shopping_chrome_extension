export class ADKClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.handlers = {
            onTextDelta: null,
            onTurnComplete: null,
            onAdapt: null,
            onError: null,
            onOpen: null,
            onClose: null,
        };
        this._seq = 0;
        this._pingTimer = null;
        this._lastPongAt = 0;
    }

    async connect(wsUrl, token) {
        return new Promise((resolve, reject) => {
            try {
                const url = token
                    ? `${wsUrl}?token=${encodeURIComponent(token)}`
                    : wsUrl;
                this.ws = new WebSocket(url);
                this.ws.binaryType = "blob";

                this.ws.onopen = () => {
                    this.isConnected = true;
                    if (this.handlers.onOpen) this.handlers.onOpen();
                    this.#startHeartbeat();
                    resolve({ success: true });
                };
                this.ws.onclose = () => {
                    this.isConnected = false;
                    this.#stopHeartbeat();
                    if (this.handlers.onClose) this.handlers.onClose();
                };
                this.ws.onerror = (e) => {
                    if (this.handlers.onError) this.handlers.onError(e);
                    if (!this.isConnected)
                        reject(new Error("WebSocket connection failed"));
                };
                this.ws.onmessage = (evt) => this.#handleMessage(evt);
            } catch (err) {
                reject(err);
            }
        });
    }

    close() {
        try {
            if (this.ws && this.ws.readyState <= 1) this.ws.close();
        } catch (_) {}
        this.isConnected = false;
    }

    setHandlers(handlers) {
        this.handlers = { ...this.handlers, ...handlers };
    }

    sendSessionStart(model, config = {}) {
        this.#sendJSON({ type: "session_start", model, config });
    }

    sendActivityStart() {
        this.#sendJSON({ type: "activity_start" });
    }

    sendActivityEnd() {
        this.#sendJSON({ type: "activity_end" });
    }

    sendTextInput(text) {
        this.#sendJSON({ type: "text_input", text, ts: Date.now() });
    }

    sendVideoChunk(blob, header = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Ensure header is the control frame for the upcoming binary: force the type
        const sanitized = { ...header };
        if (sanitized && typeof sanitized === "object") {
            delete sanitized.type;
        }
        const fullHeader = {
            ...sanitized,
            seq: this._seq++,
            ts: Date.now(),
            mime: sanitized.mime || "video/webm;codecs=vp8,opus",
            type: "video_chunk_header",
        };
        try {
            this.ws.send(JSON.stringify(fullHeader));
            this.ws.send(blob);
        } catch (err) {
            if (this.handlers.onError) this.handlers.onError(err);
        }
    }

    ping() {
        this.#sendJSON({ type: "ping" });
    }

    #sendJSON(obj) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            this.ws.send(JSON.stringify(obj));
        } catch (err) {
            if (this.handlers.onError) this.handlers.onError(err);
        }
    }

    #handleMessage(evt) {
        if (typeof evt.data === "string") {
            try {
                const msg = JSON.parse(evt.data);
                const t = msg.type;
                if (t === "pong") {
                    this._lastPongAt = Date.now();
                    return;
                }
                if (t === "text_delta" && this.handlers.onTextDelta) {
                    this.handlers.onTextDelta(msg);
                } else if (
                    t === "turn_complete" &&
                    this.handlers.onTurnComplete
                ) {
                    this.handlers.onTurnComplete(msg);
                } else if (t === "adapt" && this.handlers.onAdapt) {
                    this.handlers.onAdapt(msg);
                } else if (t === "error" && this.handlers.onError) {
                    this.handlers.onError(msg);
                }
            } catch (_) {
                // ignore non-JSON text frames
            }
        }
        // Binary frames are video chunks from server (not expected). Ignore.
    }

    #startHeartbeat() {
        this.#stopHeartbeat();
        this._lastPongAt = Date.now();
        this._pingTimer = setInterval(() => {
            try {
                this.ping();
            } catch (_) {}
        }, 25000);
    }

    #stopHeartbeat() {
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
    }
}
