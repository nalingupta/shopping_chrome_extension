export class SharedServerClientProxy {
    constructor(panelId = null) {
        this.port = null;
        this.panelId = panelId || this._genPanelId();
        this.sessionInfo = {
            isConnected: false,
            sessionEpochMs: null,
            idleCaptureFps: 0.2,
            activeCaptureFps: 1.0,
            ownerPanelId: null,
            globalActive: false,
        };
        this._listeners = new Map();
    }

    connect() {
        if (this.port) return;
        this.port = chrome.runtime.connect({ name: "media" });
        this.port.onMessage.addListener((msg) => this._onMessage(msg));
        this._post({ type: "panel_init", panelId: this.panelId });
    }

    dispose() {
        try {
            this._post({ type: "panel_dispose", panelId: this.panelId });
        } catch (_) {}
        try {
            this.port?.disconnect?.();
        } catch (_) {}
        this.port = null;
    }

    // Info
    getSessionEpochMs() {
        return this.sessionInfo.sessionEpochMs;
    }
    isConnectionActive() {
        return !!this.sessionInfo.isConnected;
    }
    getIdleFps() {
        return this.sessionInfo.idleCaptureFps;
    }
    getActiveFps() {
        return this.sessionInfo.activeCaptureFps;
    }
    getOwnerPanelId() {
        return this.sessionInfo.ownerPanelId;
    }
    isGlobalActive() {
        return !!this.sessionInfo.globalActive;
    }

    // Media forwarding (Phase 5/6)
    sendImageFrame(base64Jpeg, tsMs) {
        this._post({
            type: "image_frame",
            panelId: this.panelId,
            base64: base64Jpeg,
            tsMs,
        });
    }
    sendAudioPcm(base64, tsStartMs, numSamples, sampleRate) {
        this._post({
            type: "audio_chunk",
            panelId: this.panelId,
            base64,
            tsStartMs,
            numSamples,
            sampleRate,
        });
    }

    // Control (Phase 7)
    requestActiveToggle() {
        this._post({ type: "active_toggle", panelId: this.panelId });
    }

    // Focus ping (Phase 4)
    sendFocusPing(active) {
        this._post({
            type: "focus_ping",
            panelId: this.panelId,
            ts: Date.now(),
            active: typeof active === "boolean" ? active : undefined,
        });
    }

    on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(handler);
    }

    _emit(event, payload) {
        const arr = this._listeners.get(event) || [];
        for (const fn of arr) {
            try {
                fn(payload);
            } catch (_) {}
        }
    }

    _onMessage(msg) {
        const t = msg?.type;
        if (t === "session_info") {
            this.sessionInfo = {
                ...this.sessionInfo,
                isConnected: !!msg.isConnected,
                sessionEpochMs:
                    msg.sessionEpochMs ?? this.sessionInfo.sessionEpochMs,
                idleCaptureFps:
                    typeof msg.idleCaptureFps === "number"
                        ? msg.idleCaptureFps
                        : this.sessionInfo.idleCaptureFps,
                activeCaptureFps:
                    typeof msg.activeCaptureFps === "number"
                        ? msg.activeCaptureFps
                        : this.sessionInfo.activeCaptureFps,
                ownerPanelId: msg.ownerPanelId ?? this.sessionInfo.ownerPanelId,
                globalActive: !!msg.globalActive,
            };
            this._emit("session_info", this.sessionInfo);
        } else if (t === "owner_changed") {
            this.sessionInfo.ownerPanelId = msg.ownerPanelId;
            this._emit("owner_changed", { ownerPanelId: msg.ownerPanelId });
        } else if (t === "mode_changed") {
            this.sessionInfo.globalActive = !!msg.active;
            this._emit("mode_changed", {
                active: this.sessionInfo.globalActive,
            });
        } else if (t === "ws_state") {
            this.sessionInfo.isConnected = !!msg.isConnected;
            this._emit("ws_state", {
                isConnected: this.sessionInfo.isConnected,
            });
        } else if (t === "response") {
            this._emit("response", msg);
        } else if (t === "status") {
            this._emit("status", msg);
        }
    }

    _post(obj) {
        try {
            this.port?.postMessage?.(obj);
        } catch (_) {}
    }

    _genPanelId() {
        try {
            const r = crypto.getRandomValues(new Uint8Array(8));
            return Array.from(r)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        } catch (_) {
            return String(Math.floor(Math.random() * 1e9));
        }
    }
}
