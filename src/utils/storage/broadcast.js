import { MESSAGE_TYPES, SESSION_MODE } from "../constants.js";

export function broadcastConversationUpdate() {
    try {
        chrome.runtime
            .sendMessage({ type: MESSAGE_TYPES.CONVERSATION_UPDATED })
            .catch(() => {});
    } catch (error) {
        console.error("Error broadcasting conversation update:", error);
    }
}

export function addConversationListener(callback, conversationKey) {
    try {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === "local" && changes[conversationKey]) {
                callback(changes[conversationKey].newValue);
            }
        });
    } catch (error) {
        console.error("Error adding conversation listener:", error);
    }
}

export function broadcastSessionMode(mode) {
    try {
        if (mode !== SESSION_MODE.IDLE && mode !== SESSION_MODE.ACTIVE) return;
        const payload = {
            type: MESSAGE_TYPES.SESSION_MODE_CHANGED,
            mode,
            ts: Date.now(),
        };
        chrome.runtime.sendMessage(payload).catch(() => {});
        chrome.storage.local.set({ sessionMode: mode, sessionModeUpdatedAt: payload.ts }).catch(() => {});
    } catch (error) {
        console.error("Error broadcasting session mode:", error);
    }
}

export function addSessionModeListener(callback) {
    try {
        chrome.runtime.onMessage.addListener((msg) => {
            try {
                if (msg && msg.type === MESSAGE_TYPES.SESSION_MODE_CHANGED) {
                    callback?.(msg.mode);
                }
            } catch (_) {}
        });
        chrome.storage.onChanged.addListener((changes, namespace) => {
            try {
                if (namespace === "local" && changes.sessionMode) {
                    callback?.(changes.sessionMode.newValue);
                }
            } catch (_) {}
        });
    } catch (error) {
        console.error("Error adding session mode listener:", error);
    }
}
