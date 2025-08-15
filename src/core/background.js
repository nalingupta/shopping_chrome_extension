import { MESSAGE_TYPES } from "../utils/constants.js";
import { API_CONFIG } from "../config/api-keys.js";
import { StorageManager, clearChatStorageOnReload } from "../utils/storage.js";
// Legacy GeminiTextClient removed; text is routed via server WS through the server client in the side panel
import { MicrophoneService } from "../services/microphone-service.js";

class SharedWsSession {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.sessionEpochMs = null;
        this.seq = 0;
        this.idleCaptureFps = 0.2;
        this.activeCaptureFps = 1.0;
        this._shouldRun = true;
        this._reconnectTimer = null;
        this._reconnectAttempt = 0;
    }

    start() {
        this._shouldRun = true;
        this._connect();
    }

    stop() {
        this._shouldRun = false;
        try {
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        } catch (_) {}
        this._reconnectTimer = null;
        try {
            this.ws?.close?.();
        } catch (_) {}
        this.ws = null;
        this.isConnected = false;
    }

    _connect() {
        try {
            const url = API_CONFIG.SERVER_WS_URL;
            const ws = new WebSocket(url);
            this.ws = ws;
            ws.onopen = () => {
                this.isConnected = true;
                if (this.sessionEpochMs == null) {
                    this.sessionEpochMs = Date.now();
                    try {
                        console.info(
                            `[BG-WS] Connected; sessionEpochMs=${this.sessionEpochMs}`
                        );
                    } catch (_) {}
                } else {
                    try {
                        console.info(
                            `[BG-WS] Reconnected; reusing sessionEpochMs=${this.sessionEpochMs}`
                        );
                    } catch (_) {}
                }
                this._reconnectAttempt = 0;
                this._send({
                    type: "init",
                    sessionId: this._uuid(),
                    fps: 1,
                    sampleRate: 16000,
                    sessionEpochMs: this.sessionEpochMs,
                    seq: this._nextSeq(),
                });
            };
            ws.onmessage = (evt) => this._onMessage(evt);
            ws.onerror = (_err) => {
                // errors are surfaced via close; keep logs light
            };
            ws.onclose = () => {
                this.isConnected = false;
                if (!this._shouldRun) return;
                const backoffMs = Math.min(
                    10000,
                    500 * Math.pow(2, this._reconnectAttempt || 0)
                );
                this._reconnectAttempt += 1;
                try {
                    console.info(
                        `[BG-WS] Closed; reconnecting in ${backoffMs} ms`
                    );
                } catch (_) {}
                try {
                    if (this._reconnectTimer)
                        clearTimeout(this._reconnectTimer);
                } catch (_) {}
                this._reconnectTimer = setTimeout(
                    () => this._connect(),
                    backoffMs
                );
            };
        } catch (error) {
            try {
                console.error("[BG-WS] Connect error:", error);
            } catch (_) {}
        }
    }

    _onMessage(evt) {
        try {
            const data = JSON.parse(evt.data);
            const t = data?.type;
            if (t === "config") {
                const idle = Number(data?.idleCaptureFps);
                const active = Number(data?.activeCaptureFps);
                if (!Number.isNaN(idle) && idle > 0) this.idleCaptureFps = idle;
                if (!Number.isNaN(active) && active > 0)
                    this.activeCaptureFps = active;
                try {
                    console.info(
                        `[BG-WS] Config: idleCaptureFps=${this.idleCaptureFps} activeCaptureFps=${this.activeCaptureFps}`
                    );
                } catch (_) {}
            }
        } catch (error) {
            try {
                console.warn("[BG-WS] onMessage parse error:", error);
            } catch (_) {}
        }
    }

    _send(obj) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(obj));
            }
        } catch (error) {
            try {
                console.warn("[BG-WS] send error:", error);
            } catch (_) {}
        }
    }

    _nextSeq() {
        this.seq += 1;
        return this.seq;
    }

    _uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}

class BackgroundService {
    constructor() {
        this.currentTabId = null;
        // Start a background-owned WS session with stable epoch; no panel wiring yet
        try {
            this.wsSession = new SharedWsSession();
            this.wsSession.start();
        } catch (_) {}
        // Port registry (Phase 3 skeleton)
        this.ports = new Map(); // panelId -> Port
        this.panelFocusMs = new Map(); // panelId -> last focus ts
        this.ownerPanelId = null; // current owner
        this.mostRecentFocusedPanelId = null;
        this.globalActive = false;
        this._modeTransitionInFlight = false;
        try {
            chrome.runtime.onConnect.addListener((port) => {
                if (!port || port.name !== "media") return;
                port.onMessage.addListener((msg) =>
                    this.handlePortMessage(port, msg)
                );
                port.onDisconnect.addListener(() => this.cleanupPort(port));
            });
        } catch (_) {}
        this.initializeExtension();
        this.setupEventListeners();
    }

    handlePortMessage(port, msg) {
        const t = msg?.type;
        if (t === "panel_init") {
            const panelId = String(msg?.panelId || "");
            if (!panelId) return;
            this.ports.set(panelId, port);
            // initialize focus timestamp to now so first opener can become owner
            const now = Date.now();
            this.panelFocusMs.set(panelId, now);
            this.mostRecentFocusedPanelId = panelId;
            this._maybeSelectOwner();
            // Respond with session info snapshot
            this._postToPort(port, {
                type: "session_info",
                isConnected: !!this.wsSession?.isConnected,
                sessionEpochMs: this.wsSession?.sessionEpochMs ?? null,
                idleCaptureFps: this.wsSession?.idleCaptureFps ?? 0.2,
                activeCaptureFps: this.wsSession?.activeCaptureFps ?? 1.0,
                ownerPanelId: this.ownerPanelId,
                globalActive: !!this.globalActive,
            });
            return;
        }
        if (t === "panel_dispose") {
            const panelId = String(msg?.panelId || "");
            if (panelId && this.ports.has(panelId)) {
                this.ports.delete(panelId);
            }
            if (panelId) this.panelFocusMs.delete(panelId);
            if (panelId && this.ownerPanelId === panelId) {
                // Reassign owner to most-recent remaining panel, if any
                this.ownerPanelId = null;
                this._maybeSelectOwner();
                this._broadcast({
                    type: "owner_changed",
                    ownerPanelId: this.ownerPanelId,
                });
                try {
                    console.info(`[BG] owner_changed -> ${this.ownerPanelId}`);
                } catch (_) {}
            }
            return;
        }
        if (t === "focus_ping") {
            const panelId = String(msg?.panelId || "");
            const ts = Number(msg?.ts || Date.now());
            const isActive = msg?.active !== undefined ? !!msg.active : true;
            if (!panelId || !this.ports.has(panelId)) return;
            if (!isActive) return; // ignore pings from inactive panels
            this.panelFocusMs.set(panelId, ts);
            this.mostRecentFocusedPanelId = panelId;
            const prevOwner = this.ownerPanelId;
            this._maybeSelectOwner();
            if (this.ownerPanelId !== prevOwner) {
                this._broadcast({
                    type: "owner_changed",
                    ownerPanelId: this.ownerPanelId,
                });
                try {
                    console.info(
                        `[BG] owner_changed -> ${this.ownerPanelId} (by ping)`
                    );
                } catch (_) {}
            }
            return;
        }
        if (t === "active_toggle") {
            // Serialize transitions
            if (this._modeTransitionInFlight) return;
            this._modeTransitionInFlight = true;
            try {
                const targetActive = !this.globalActive;
                const epoch = this.wsSession?.sessionEpochMs ?? Date.now();
                const tsMs = Date.now() - epoch;
                if (targetActive) {
                    if (this.wsSession?.isConnected) {
                        this.wsSession._send({
                            type: "active_start",
                            seq: this.wsSession._nextSeq(),
                            tsMs,
                        });
                    }
                    this.globalActive = true;
                } else {
                    if (this.wsSession?.isConnected) {
                        this.wsSession._send({
                            type: "active_end",
                            seq: this.wsSession._nextSeq(),
                            tsMs,
                        });
                    }
                    this.globalActive = false;
                }
                // Broadcast new mode to panels
                this._broadcast({
                    type: "mode_changed",
                    active: this.globalActive,
                });
            } catch (_) {
            } finally {
                // small debounce window
                setTimeout(() => {
                    this._modeTransitionInFlight = false;
                }, 200);
            }
            return;
        }
        if (t === "image_frame") {
            const panelId = String(msg?.panelId || "");
            if (!panelId || panelId !== this.ownerPanelId) return;
            if (!this.wsSession?.isConnected) return;
            const base64 = String(msg?.base64 || "");
            const tsMs = Number(msg?.tsMs || 0);
            try {
                this.wsSession._send({
                    type: "imageFrame",
                    seq: this.wsSession._nextSeq(),
                    tsMs,
                    mime: "image/jpeg",
                    base64,
                });
            } catch (_) {}
            return;
        }
        if (t === "audio_chunk") {
            const panelId = String(msg?.panelId || "");
            if (!panelId || panelId !== this.ownerPanelId) return;
            if (!this.wsSession?.isConnected) return;
            const base64 = String(msg?.base64 || "");
            const tsStartMs = Number(msg?.tsStartMs || 0);
            const numSamples = Number(msg?.numSamples || 0);
            const sampleRate = Number(msg?.sampleRate || 16000);
            if (!base64 || !numSamples || !sampleRate) return;
            try {
                this.wsSession._send({
                    type: "audioChunk",
                    seq: this.wsSession._nextSeq(),
                    tsStartMs,
                    numSamples,
                    sampleRate,
                    mime: "audio/pcm",
                    base64,
                });
            } catch (_) {}
            return;
        }
        // Future phases will handle other control messages
    }

    cleanupPort(port) {
        // Remove any mapping entries for this port
        try {
            for (const [pid, p] of this.ports.entries()) {
                if (p === port) this.ports.delete(pid);
            }
        } catch (_) {}
    }

    _postToPort(port, obj) {
        try {
            port?.postMessage?.(obj);
        } catch (_) {}
    }

    _broadcast(obj) {
        try {
            for (const p of this.ports.values()) {
                this._postToPort(p, obj);
            }
        } catch (_) {}
    }

    _maybeSelectOwner() {
        if (this.ports.size === 0) {
            this.ownerPanelId = null;
            return;
        }
        // Choose the panel with the highest focus timestamp; fallback to any existing port
        let bestId = null;
        let bestTs = -1;
        for (const [pid, ts] of this.panelFocusMs.entries()) {
            if (!this.ports.has(pid)) continue;
            const tsv = Number(ts || 0);
            if (tsv > bestTs) {
                bestTs = tsv;
                bestId = pid;
            }
        }
        if (!bestId) {
            // Fallback: pick first available port key
            const it = this.ports.keys();
            const first = it.next();
            bestId = first && !first.done ? first.value : null;
        }
        this.ownerPanelId = bestId;
    }

    initializeExtension() {
        // Mark extension reload; LifecycleManager will clear conversation when side panel loads
        this.markExtensionReloaded();

        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            this.markExtensionReloaded();
        });

        chrome.runtime.onStartup.addListener(() => {
            this.markExtensionReloaded();
        });

        chrome.action.onClicked.addListener(async (tab) => {
            // Store the current tab ID for permission context
            this.currentTabId = tab.id;

            await chrome.sidePanel.open({ tabId: tab.id });
            await StorageManager.set("sidePanelOpen", true);
        });

        this.restoreStateAfterReload();
    }

    async restoreStateAfterReload() {
        // Hot reload functionality removed
    }

    async markExtensionReloaded() {
        try {
            await StorageManager.set("extensionReloaded", Date.now());
        } catch (error) {
            // Ignore errors
        }
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                const handler = this.getMessageHandler(request.type);
                if (handler) {
                    handler(request, sender, sendResponse);
                    return true;
                }
            }
        );
    }

    getMessageHandler(type) {
        const handlers = {
            [MESSAGE_TYPES.PROCESS_USER_QUERY]:
                this.handleProcessUserQuery.bind(this),
            [MESSAGE_TYPES.REQUEST_MIC_PERMISSION]:
                this.handleMicPermissionRequest.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_OPENED]:
                this.handleSidePanelOpened.bind(this),
            [MESSAGE_TYPES.SIDE_PANEL_CLOSED]:
                this.handleSidePanelClosed.bind(this),
            [MESSAGE_TYPES.LISTENING_STOPPED]:
                this.handleListeningStopped.bind(this),
            [MESSAGE_TYPES.CONVERSATION_UPDATED]:
                this.handleConversationUpdated.bind(this),
        };

        return handlers[type] || null;
    }

    // Page info update handlers removed

    async handleProcessUserQuery(request, sender, sendResponse) {
        // Route text to side panel UI; server client will forward to server over WS
        try {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.PROCESS_USER_QUERY,
                data: request.data,
            });
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleMicPermissionRequest(request, sender, sendResponse) {
        try {
            const result = await MicrophoneService.request();
            sendResponse(result);
        } catch (error) {
            sendResponse({
                success: false,
                error: "permission_request_failed",
                details: error.message,
            });
        }
    }

    async handleSidePanelOpened(request, sender, sendResponse) {
        try {
            await StorageManager.set("sidePanelOpen", true);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleSidePanelClosed(request, sender, sendResponse) {
        try {
            await StorageManager.set("sidePanelOpen", false);
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleListeningStopped(request, sender, sendResponse) {
        try {
            // Any additional cleanup can be added here if needed
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleConversationUpdated(request, sender, sendResponse) {
        try {
            // Broadcast conversation update to all extension contexts
            chrome.runtime
                .sendMessage({
                    type: MESSAGE_TYPES.CONVERSATION_UPDATED,
                })
                .catch(() => {
                    // Ignore errors - not all contexts may be listening
                });

            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async injectContentScript(tabId, files) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files,
            });
        } catch (error) {
            // Ignore injection errors
        }
    }
}

// Initialize the background service
new BackgroundService();
