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
            onTranscript: null,
        };
        this.sessionStartMs = null;
        this._isActiveSession = false;
        // Default to 1 FPS to avoid initial high-rate capture before server config arrives
        this.captureFps = 1;

        // Reconnection / liveness state
        this.manualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectTimerId = null;
        this.connectPromise = null;
        this.connectTimeoutId = null;
        this.livenessIntervalId = null;
        this.lastMessageAt = 0;

        // Pending queue for control/text (non-media) while disconnected
        this.pendingQueue = [];
        this.maxPendingQueue = API_CONFIG.PENDING_QUEUE_MAX || 50;

        // Online/offline awareness
        try {
            window.addEventListener("online", () => {
                if (!this.isConnected && !this.manualClose && !this.connectPromise) {
                    this.#scheduleReconnect(true);
                }
            });
            window.addEventListener("offline", () => {
                // No-op; retries will be paused because navigator.onLine is false
            });
        } catch (_) {}
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
    setTranscriptCallback(cb) {
        this.callbacks.onTranscript = cb;
    }

    getConnectionStatus() {
        return { isConnected: this.isConnected };
    }

    async connect() {
        if (this.isConnected) return { success: true };
        if (this.connectPromise) return this.connectPromise;
        this.manualClose = false;
        this.connectPromise = new Promise((resolve) => {
            try {
                const url = API_CONFIG.SERVER_WS_URL;
                this.ws = new WebSocket(url);

                // Guard: connection timeout
                const timeoutMs = API_CONFIG.CONNECTION_TIMEOUT || 30000;
                this.connectTimeoutId = setTimeout(() => {
                    try {
                        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                            try { this.ws.close(); } catch (_) {}
                        }
                    } finally {
                        this.connectTimeoutId = null;
                        if (!this.isConnected) {
                            this.#emitError(new Error("connect_timeout"));
                            this.#scheduleReconnect();
                            resolve({ success: false, error: "connect_timeout" });
                            this.connectPromise = null;
                        }
                    }
                }, timeoutMs);

                this.ws.onopen = () => {
                    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.sessionStartMs = performance.now();
                    this.lastMessageAt = Date.now();
                    this.#startLivenessMonitor();
                    try {
                        const sessionStartWallMs = Date.now();
                        // Broadcast session start so other contexts can align
                        chrome.runtime
                            .sendMessage({
                                type: "SESSION_STARTED",
                                sessionStartWallMs,
                                ts: Date.now(),
                            })
                            .catch(() => {});
                        try {
                            chrome.storage.local
                                .set({
                                    sessionClock: {
                                        sessionStartWallMs,
                                        updatedAt: Date.now(),
                                    },
                                })
                                .catch(() => {});
                        } catch (_) {}
                    } catch (_) {}
                    this.#emitConnectionState("connected");
                    this.#flushPendingQueue();
                    resolve({ success: true });
                    this.connectPromise = null;
                };
                this.ws.onmessage = (evt) => this.#handleMessage(evt);
                this.ws.onerror = (err) => {
                    this.#emitError(err);
                };
                this.ws.onclose = () => {
                    this.isConnected = false;
                    this._isActiveSession = false;
                    this.#emitConnectionState("disconnected");
                    this.#clearTimers();
                    this.ws = null;
                    this.connectPromise = null;
                    if (!this.manualClose) {
                        this.#scheduleReconnect();
                    }
                };
            } catch (error) {
                this.#emitError(error);
                resolve({
                    success: false,
                    error: String(error?.message || error),
                });
                this.connectPromise = null;
            }
        });
        return this.connectPromise;
    }

    async disconnect() {
        try {
            this.manualClose = true;
            this.#clearTimers();
            if (this.ws) {
                try { this.ws.close(); } catch (_) {}
            }
            this.ws = null;
            this.isConnected = false;
            this._isActiveSession = false;
            this.#emitConnectionState("disconnected");
            return { success: true };
        } catch (error) {
            this.#emitError(error);
            return { success: false, error: String(error?.message || error) };
        }
    }

    async beginActiveSession({ fps = 1, sampleRate = 16000 } = {}) {
        if (!this.isConnected) {
            return { success: false, error: "not_connected" };
        }
        if (this._isActiveSession) return { success: true };
        try {
            this.#send({
                type: "init",
                sessionId: this.#uuid(),
                fps,
                sampleRate,
                seq: this.#nextSeq(),
            });
            this._isActiveSession = true;
            return { success: true };
        } catch (error) {
            this.#emitError(error);
            return { success: false, error: String(error?.message || error) };
        }
    }

    async endActiveSession() {
        if (!this.isConnected) return { success: true };
        if (!this._isActiveSession) return { success: true };
        try {
            this.#send({
                type: "control",
                action: "activeSessionClosed",
                seq: this.#nextSeq(),
            });
            this._isActiveSession = false;
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

    // Removed: transcripts are generated by the backend; the extension no longer sends them

    sendTextMessage(text) {
        if (!this.isConnected) return;
        this.#send({
            type: "text",
            seq: this.#nextSeq(),
            tsMs: Date.now(),
            text,
        });
    }

    sendLinks({ links, tsMs }) {
        if (!this.isConnected) return;
        try {
            const payload = {
                type: "links",
                seq: this.#nextSeq(),
                tsMs: typeof tsMs === "number" ? tsMs : Date.now(),
                links: Array.isArray(links) ? links : [],
            };
            this.#send(payload);
        } catch (error) {
            this.#emitError(error);
        }
    }

    sendTabInfo({ info, tsMs }) {
        if (!this.isConnected) return;
        try {
            const payload = {
                type: "tabInfo",
                seq: this.#nextSeq(),
                tsMs: typeof tsMs === "number" ? tsMs : Date.now(),
                info: info || {},
            };
            this.#send(payload);
        } catch (error) {
            this.#emitError(error);
        }
    }

    // Internal
    #handleMessage(evt) {
        try {
            const data = JSON.parse(evt.data);
            const t = data?.type;
            this.lastMessageAt = Date.now();
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
            } else if (t === "config" && typeof data.captureFps === "number") {
                this.captureFps = data.captureFps;
                this.callbacks.onStatus?.({
                    type: "config",
                    captureFps: this.captureFps,
                });
            } else if (t === "transcript") {
                const payload = {
                    text: String(data?.text || ""),
                    isFinal: !!data?.isFinal,
                    tsMs: typeof data?.tsMs === "number" ? data.tsMs : null,
                };
                this.callbacks.onTranscript?.(payload);
            }
        } catch (error) {
            this.#emitError(error);
        }
    }

    #send(obj) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
                return;
            }
            // Queue only non-media messages when not connected
            const t = obj?.type;
            if (t === "text" || t === "links" || t === "tabInfo" || t === "control" || t === "init") {
                if (this.pendingQueue.length >= this.maxPendingQueue) {
                    this.pendingQueue.shift();
                }
                this.pendingQueue.push(obj);
            }
        } catch (error) {
            this.#emitError(error);
        }
    }

    #flushPendingQueue() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            while (this.pendingQueue.length > 0) {
                const obj = this.pendingQueue.shift();
                this.ws.send(JSON.stringify(obj));
            }
        } catch (error) {
            this.#emitError(error);
        }
    }

    #startLivenessMonitor() {
        if (this.livenessIntervalId) { clearInterval(this.livenessIntervalId); }
        const intervalMs = API_CONFIG.LIVENESS_CHECK_INTERVAL_MS || 5000;
        const timeoutMs = API_CONFIG.LIVENESS_TIMEOUT_MS || 15000;
        this.livenessIntervalId = setInterval(() => {
            try {
                if (!this.isConnected || !this.ws) return;
                const now = Date.now();
                if (this.lastMessageAt && now - this.lastMessageAt > timeoutMs) {
                    // Force a reconnect by closing the socket
                    try { this.ws.close(); } catch (_) {}
                }
            } catch (_) {}
        }, intervalMs);
    }

    #scheduleReconnect(immediate = false) {
        // Stop if limited attempts reached
        const maxAttempts = API_CONFIG.RETRY_ATTEMPTS ?? 0;
        if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
            return;
        }
        if (this.reconnectTimerId) {
            clearTimeout(this.reconnectTimerId);
            this.reconnectTimerId = null;
        }
        const initial = API_CONFIG.BACKOFF_INITIAL_MS || 500;
        const max = API_CONFIG.BACKOFF_MAX_MS || 15000;
        const mult = API_CONFIG.BACKOFF_MULTIPLIER || 2;
        const jitter = API_CONFIG.BACKOFF_JITTER_MS || 250;
        const baseDelay = Math.min(max, initial * Math.pow(mult, this.reconnectAttempts));
        const delay = immediate ? 0 : baseDelay + Math.floor(Math.random() * jitter);
        const doRetry = () => {
            if (this.manualClose) return;
            if (typeof navigator !== "undefined" && navigator.onLine === false) {
                // Wait until online
                const onOnline = () => {
                    window.removeEventListener("online", onOnline);
                    this.connect();
                };
                window.addEventListener("online", onOnline, { once: true });
                return;
            }
            this.connect();
        };
        this.reconnectTimerId = setTimeout(doRetry, delay);
        this.reconnectAttempts += 1;
    }

    #clearTimers() {
        if (this.reconnectTimerId) { clearTimeout(this.reconnectTimerId); this.reconnectTimerId = null; }
        if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
        if (this.livenessIntervalId) { clearInterval(this.livenessIntervalId); this.livenessIntervalId = null; }
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

    getCaptureFps() {
        return this.captureFps;
    }

    isActiveSession() {
        return this._isActiveSession;
    }
}
