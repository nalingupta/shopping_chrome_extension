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

export class ChatStateManager {
    static STATE_KEY = "shoppingAssistant_chatState";
    static MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    static saveState(messages, isWelcomeVisible) {
        try {
            const state = {
                messages: messages.map((msg) => ({
                    content: msg.content,
                    type: msg.type,
                })),
                isWelcomeVisible,
                timestamp: Date.now(),
            };

            localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
        } catch (error) {}
    }

    static restoreState() {
        try {
            const savedState = localStorage.getItem(this.STATE_KEY);
            if (!savedState) return null;

            const state = JSON.parse(savedState);

            // Don't restore if state is too old
            if (Date.now() - state.timestamp > this.MAX_AGE_MS) {
                this.clearState();
                return null;
            }

            return state;
        } catch (error) {
            this.clearState();
            return null;
        }
    }

    static clearState() {
        try {
            localStorage.removeItem(this.STATE_KEY);
        } catch (error) {}
    }
}

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
    } catch (error) {
        // Ignore errors during cleanup
    }
}
