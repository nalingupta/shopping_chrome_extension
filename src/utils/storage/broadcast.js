import { MESSAGE_TYPES } from "../constants.js";

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
