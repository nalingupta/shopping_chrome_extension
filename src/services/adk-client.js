export class ADKClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.sessionReady = false;
        this._readyResolve = null;
        this._readyPromise = new Promise((res) => (this._readyResolve = res));
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
        this.lastCloseWasClean = null;
        this._lastCloseLogAt = 0;
    }

    async connect(wsUrl, token) {
        return new Promise((resolve, reject) => {
            try {
                const url = token
                    ? `${wsUrl}?token=${encodeURIComponent(token)}`
                    : wsUrl;
                this.ws = new WebSocket(url);
                this.ws.binaryType = "blob";
                this.sessionReady = false;

                this.ws.onopen = () => {
                    this.isConnected = true;
                    if (this.handlers.onOpen) this.handlers.onOpen();
                    this.#startHeartbeat();
                    // Send an initial ping to keep the connection alive before session_start
                    try {
                        this.ping();
                    } catch (_) {}
                    resolve({ success: true });
                };
                this.ws.onclose = (evt) => {
                    this.isConnected = false;
                    this.sessionReady = false;
                    this.#stopHeartbeat();
                    // Persist clean-close flag for retry logic
                    this.lastCloseWasClean = !!(evt && evt.wasClean);
                    // Reduce noise in chrome://extensions Errors: downgrade clean/expected closes
                    try {
                        const details = {
                            code: evt?.code,
                            reason: evt?.reason,
                            wasClean: evt?.wasClean,
                        };
                        const now = Date.now();
                        if (now - this._lastCloseLogAt > 5000) {
                            this._lastCloseLogAt = now;
                            if (
                                evt?.wasClean === true ||
                                evt?.code === 1000 ||
                                evt?.code === 1001
                            ) {
                                console.debug(
                                    "[ADKClient] WS closed (clean)",
                                    details
                                );
                            } else {
                                console.warn("[ADKClient] WS closed", details);
                            }
                        }
                    } catch (_) {}
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
        this.sessionReady = false;
        this._readyPromise = new Promise((res) => (this._readyResolve = res));
        try {
            console.debug("[ADKClient] sending session_start", { model });
        } catch (_) {}
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

    // ADK: send raw PCM16 audio as binary with explicit mime header
    sendAudioChunk(blob, header = {}) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const sanitized = { ...header };
        if (sanitized && typeof sanitized === "object") {
            delete sanitized.type;
        }
        const fullHeader = {
            ...sanitized,
            seq: this._seq++,
            ts: Date.now(),
            mime: sanitized.mime || "audio/pcm;rate=16000",
            type: "audio_chunk_header",
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
                if (msg.ok === true && !t) {
                    // server session_start ack
                    this.sessionReady = true;
                    if (this._readyResolve) this._readyResolve(true);
                    return;
                }
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

    async waitUntilReady(timeoutMs = 15000) {
        if (this.sessionReady) return { success: true };
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // One automatic reconnect on clean close without session
                if (this.lastCloseWasClean === true && !this.sessionReady) {
                    try {
                        console.warn(
                            "[ADKClient] retrying connect after clean close before ready"
                        );
                    } catch (_) {}
                    this.connect(this._lastUrl || "", this._lastToken || "")
                        .then(() => {
                            this.sendSessionStart(
                                this._lastModel || "",
                                this._lastConfig || {}
                            );
                            return this.waitUntilReady(timeoutMs);
                        })
                        .then((res) => resolve(res))
                        .catch(() =>
                            resolve({
                                success: false,
                                error: "session_ready_timeout",
                            })
                        );
                    return;
                }
                resolve({ success: false, error: "session_ready_timeout" });
            }, timeoutMs);
            this._readyPromise.then(() => {
                clearTimeout(timer);
                resolve({ success: true });
            });
        });
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
