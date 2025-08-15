import { ServerWsClient } from "../server-ws-client.js";
import { DEFAULT_CAPTURE_FPS } from "../../config/features.js";

export class ServerClient {
    constructor() {
        this.serverAPI = new ServerWsClient();
        this._isConnected = false;
        this._lastUserMessage = null;

        this._setupCallbacks();
    }

    _setupCallbacks() {
        this.serverAPI.setBotResponseCallback((data) => {
            this._handleResponse(data);
        });

        this.serverAPI.setStatusCallback((update) => {
            this._handleStreamingUpdate(update);
        });

        this.serverAPI.setConnectionStateCallback((state) => {
            this._isConnected = state === "connected";
        });

        this.serverAPI.setErrorCallback((error) => {
            console.error("AI error:", error);
        });
    }

    async connect(opts = {}) {
        if (this._isConnected) return { success: true };
        try {
            const result = await this.serverAPI.connect();
            if (!result.success) {
                throw new Error(
                    result.error || "Failed to connect to AI server"
                );
            }
            this._isConnected = true;
            return { success: true };
        } catch (error) {
            console.error("Failed to connect to AI server:", error);
            return { success: false, error: error.message };
        }
    }

    async disconnect() {
        try {
            await this.serverAPI.disconnect();
            this._isConnected = false;
            return { success: true };
        } catch (error) {
            console.error("Failed to disconnect from AI server:", error);
            return { success: false, error: error.message };
        }
    }

    isConnectionActive() {
        return (
            this._isConnected &&
            this.serverAPI.getConnectionStatus().isConnected
        );
    }

    async sendLinks(links, tsMs) {
        try {
            if (!this.isConnectionActive()) return { success: false, error: "not_connected" };
            if (!Array.isArray(links) || links.length === 0) return { success: true };
            this.serverAPI.sendLinks({ links, tsMs: typeof tsMs === "number" ? tsMs : undefined });
            return { success: true };
        } catch (error) {
            console.error("Failed to send links over WS:", error);
            return { success: false, error: error.message };
        }
    }

    async beginActiveSession({ sampleRate = 16000, fps = DEFAULT_CAPTURE_FPS } = {}) {
        try {
            const result = await this.serverAPI.beginActiveSession({ sampleRate, fps });
            if (!result?.success) {
                return { success: false, error: result?.error || "begin_active_failed" };
            }
            return { success: true };
        } catch (error) {
            console.error("Failed to begin active session:", error);
            return { success: false, error: error.message };
        }
    }

    async endActiveSession() {
        try {
            const result = await this.serverAPI.endActiveSession();
            if (!result?.success) {
                return { success: false, error: result?.error || "end_active_failed" };
            }
            return { success: true };
        } catch (error) {
            console.error("Failed to end active session:", error);
            return { success: false, error: error.message };
        }
    }

    sendAudioPcm(base64Pcm, tsStartMs, numSamples, sampleRate = 16000) {
        if (!this.isConnectionActive()) return;
        this.serverAPI.sendAudioPcm(
            base64Pcm,
            tsStartMs,
            numSamples,
            sampleRate
        );
    }

    sendImageFrame(base64Jpeg, tsMs) {
        if (!this.isConnectionActive()) return;
        this.serverAPI.sendImageFrame(base64Jpeg, tsMs);
    }

    async sendTextMessage(message) {
        try {
            this.serverAPI.sendTextMessage(String(message || ""));
            return { success: true };
        } catch (error) {
            console.error("Failed to send text over WS:", error);
            return { success: false, error: error.message };
        }
    }

    isConnected() {
        return this.isConnectionActive();
    }

    getSessionStartMs() {
        return this.serverAPI.sessionStartMs || null;
    }

    isActiveSession() {
        return !!this.serverAPI.isActiveSession?.();
    }

    // Page info handling removed

    setLastUserMessage(text) {
        this._lastUserMessage = typeof text === "string" ? text : null;
    }

    setBotResponseCallback(callback) {
        this.serverAPI.setBotResponseCallback(callback);
    }

    setStreamingUpdateCallback(callback) {
        this.serverAPI.setStatusCallback(callback);
    }

    setConnectionStateCallback(callback) {
        this.serverAPI.setConnectionStateCallback(callback);
    }

    setErrorCallback(callback) {
        this.serverAPI.setErrorCallback(callback);
    }

    _handleResponse(_data) {}
    _handleStreamingUpdate(_update) {}
}
