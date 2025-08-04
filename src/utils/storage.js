// Storage utility functions
export class StorageManager {
    static async set(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (error) {
            console.error(`Failed to save ${key}:`, error);
        }
    }

    static async get(key) {
        try {
            const result = await chrome.storage.local.get([key]);
            return result[key];
        } catch (error) {
            console.error(`Failed to get ${key}:`, error);
            return null;
        }
    }

    static async remove(key) {
        try {
            await chrome.storage.local.remove([key]);
        } catch (error) {
            console.error(`Failed to remove ${key}:`, error);
        }
    }

    static async clear() {
        try {
            await chrome.storage.local.clear();
        } catch (error) {
            console.error('Failed to clear storage:', error);
        }
    }
}

export class ChatStateManager {
    static STATE_KEY = 'shoppingAssistant_chatState';
    static MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    static saveState(messages, isWelcomeVisible) {
        try {
            const state = {
                messages: messages.map(msg => ({
                    content: msg.content,
                    type: msg.type
                })),
                isWelcomeVisible,
                timestamp: Date.now()
            };
            
            localStorage.setItem(this.STATE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('Failed to save chat state:', error);
        }
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
            console.warn('Failed to restore chat state:', error);
            this.clearState();
            return null;
        }
    }

    static clearState() {
        try {
            localStorage.removeItem(this.STATE_KEY);
        } catch (error) {
            console.warn('Failed to clear chat state:', error);
        }
    }
}