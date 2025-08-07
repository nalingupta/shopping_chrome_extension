import { MESSAGE_TYPES } from "./constants.js";
import { UnifiedConversationManager } from "./storage/conversation-storage.js";
import { ChatStateManager } from "./storage/chat-state-storage.js";

// Re-export UnifiedConversationManager for backward compatibility
export { UnifiedConversationManager };
// Re-export ChatStateManager for backward compatibility
export { ChatStateManager };

// Storage utility functions
export class StorageManager {
    static async set(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (error) {}
    }

    static async get(key) {
        try {
            const result = await chrome.storage.local.get([key]);
            return result[key];
        } catch (error) {
            return null;
        }
    }

    static async remove(key) {
        try {
            await chrome.storage.local.remove([key]);
        } catch (error) {}
    }

    static async clear() {
        try {
            await chrome.storage.local.clear();
        } catch (error) {}
    }
}

// Legacy classes for backward compatibility (will be removed in future)

export class ConversationHistoryManager {
    static HISTORY_KEY = "shoppingAssistant_conversationHistory";
    static MAX_HISTORY_LENGTH = 50; // Keep last 50 messages

    static saveMessageSync(content, role) {
        try {
            const history = this.getHistory();

            history.push({
                role: role,
                parts: [{ text: content }],
                timestamp: Date.now(),
            });

            // Keep only the last MAX_HISTORY_LENGTH messages
            if (history.length > this.MAX_HISTORY_LENGTH) {
                history.splice(0, history.length - this.MAX_HISTORY_LENGTH);
            }

            localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
        } catch (error) {}
    }

    static getHistory() {
        try {
            const history = localStorage.getItem(this.HISTORY_KEY);
            return history ? JSON.parse(history) : [];
        } catch (error) {
            return [];
        }
    }

    static getContextForAPI() {
        try {
            const history = this.getHistory();
            return history.map((msg) => ({
                role: msg.role,
                parts: msg.parts,
            }));
        } catch (error) {
            return [];
        }
    }

    static clearHistory() {
        try {
            localStorage.removeItem(this.HISTORY_KEY);
        } catch (error) {}
    }
}

// Clear all chat-related storage when extension is reloaded/installed
export function clearChatStorageOnReload() {
    try {
        ChatStateManager.clearState();
        ConversationHistoryManager.clearHistory();
        UnifiedConversationManager.clearConversation();
    } catch (error) {
        // Ignore errors during cleanup
    }
}
