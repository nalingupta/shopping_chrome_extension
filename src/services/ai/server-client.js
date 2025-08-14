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
            const result = await this.serverAPI.connect({
                fps: DEFAULT_CAPTURE_FPS,
                sampleRate:
                    typeof opts.sampleRate === "number" && opts.sampleRate > 0
                        ? opts.sampleRate
                        : 16000,
            });
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
