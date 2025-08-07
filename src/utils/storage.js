import { MESSAGE_TYPES } from "./constants.js";

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

export class UnifiedConversationManager {
    static CONVERSATION_KEY = "shoppingAssistant_conversation";
    static MAX_HISTORY_LENGTH = 50; // Keep last 50 messages
    static MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    static async getConversation() {
        try {
            const result = await chrome.storage.sync.get([
                this.CONVERSATION_KEY,
            ]);
            const conversation = result[this.CONVERSATION_KEY];

            if (!conversation) {
                return {
                    messages: [],
                    lastUpdated: Date.now(),
                    isWelcomeVisible: true,
                };
            }

            // Check if conversation is too old
            if (Date.now() - conversation.lastUpdated > this.MAX_AGE_MS) {
                await this.clearConversation();
                return {
                    messages: [],
                    lastUpdated: Date.now(),
                    isWelcomeVisible: true,
                };
            }

            return conversation;
        } catch (error) {
            console.error("Error getting conversation:", error);
            return {
                messages: [],
                lastUpdated: Date.now(),
                isWelcomeVisible: true,
            };
        }
    }

    static async saveMessage(content, role, timestamp = Date.now()) {
        try {
            const conversation = await this.getConversation();

            conversation.messages.push({
                content: content,
                role: role,
                timestamp: timestamp,
            });

            // Keep only the last MAX_HISTORY_LENGTH messages
            if (conversation.messages.length > this.MAX_HISTORY_LENGTH) {
                conversation.messages.splice(
                    0,
                    conversation.messages.length - this.MAX_HISTORY_LENGTH
                );
            }

            conversation.lastUpdated = Date.now();

            await chrome.storage.sync.set({
                [this.CONVERSATION_KEY]: conversation,
            });

            console.log(
                `🔄 UnifiedConversationManager: Saved message (${role}) - broadcasting to all windows`
            );

            // Broadcast change to all windows
            this.broadcastConversationUpdate();

            return true;
        } catch (error) {
            console.error("Error saving message:", error);
            return false;
        }
    }

    static async saveMessages(messages, isWelcomeVisible = false) {
        try {
            const conversation = await this.getConversation();

            // Convert UI format to internal format
            conversation.messages = messages.map((msg) => ({
                content: msg.content,
                role: msg.type === "user" ? "user" : "assistant",
                timestamp: Date.now(),
            }));

            conversation.isWelcomeVisible = isWelcomeVisible;
            conversation.lastUpdated = Date.now();

            await chrome.storage.sync.set({
                [this.CONVERSATION_KEY]: conversation,
            });

            console.log(
                `🔄 UnifiedConversationManager: Saved ${messages.length} messages - broadcasting to all windows`
            );

            // Broadcast change to all windows
            this.broadcastConversationUpdate();

            return true;
        } catch (error) {
            console.error("Error saving messages:", error);
            return false;
        }
    }

    // For UI display - returns messages in UI format
    static async getMessagesForUI() {
        try {
            const conversation = await this.getConversation();
            return conversation.messages.map((msg) => ({
                content: msg.content,
                type: msg.role === "user" ? "user" : "assistant",
            }));
        } catch (error) {
            console.error("Error getting messages for UI:", error);
            return [];
        }
    }

    // For Gemini API - returns messages in API format
    static async getContextForAPI() {
        try {
            const conversation = await this.getConversation();
            return conversation.messages.map((msg) => ({
                role: msg.role,
                parts: [{ text: msg.content }],
            }));
        } catch (error) {
            console.error("Error getting context for API:", error);
            return [];
        }
    }

    static async getWelcomeScreenState() {
        try {
            const conversation = await this.getConversation();
            return conversation.isWelcomeVisible;
        } catch (error) {
            console.error("Error getting welcome screen state:", error);
            return true;
        }
    }

    static async setWelcomeScreenState(isVisible) {
        try {
            const conversation = await this.getConversation();
            conversation.isWelcomeVisible = isVisible;
            conversation.lastUpdated = Date.now();

            await chrome.storage.sync.set({
                [this.CONVERSATION_KEY]: conversation,
            });

            // Broadcast change to all windows
            this.broadcastConversationUpdate();

            return true;
        } catch (error) {
            console.error("Error setting welcome screen state:", error);
            return false;
        }
    }

    static async clearConversation() {
        try {
            await chrome.storage.sync.remove([this.CONVERSATION_KEY]);

            // Broadcast change to all windows
            this.broadcastConversationUpdate();

            return true;
        } catch (error) {
            console.error("Error clearing conversation:", error);
            return false;
        }
    }

    static async addConversationListener(callback) {
        try {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === "sync" && changes[this.CONVERSATION_KEY]) {
                    callback(changes[this.CONVERSATION_KEY].newValue);
                }
            });
        } catch (error) {
            console.error("Error adding conversation listener:", error);
        }
    }

    static broadcastConversationUpdate() {
        try {
            // Send message to all extension contexts
            chrome.runtime
                .sendMessage({
                    type: MESSAGE_TYPES.CONVERSATION_UPDATED,
                })
                .catch(() => {
                    // Ignore errors - not all contexts may be listening
                });
        } catch (error) {
            console.error("Error broadcasting conversation update:", error);
        }
    }

    // Migration helper - convert old localStorage data to new format
    static async migrateFromLocalStorage() {
        try {
            // Check if migration is needed
            const conversation = await this.getConversation();
            if (conversation.messages.length > 0) {
                return; // Already migrated
            }

            // Try to migrate from old ChatStateManager
            const oldChatState = localStorage.getItem(
                "shoppingAssistant_chatState"
            );
            if (oldChatState) {
                const parsed = JSON.parse(oldChatState);
                if (parsed.messages && parsed.messages.length > 0) {
                    await this.saveMessages(
                        parsed.messages,
                        parsed.isWelcomeVisible
                    );
                    localStorage.removeItem("shoppingAssistant_chatState");
                }
            }

            // Try to migrate from old ConversationHistoryManager
            const oldHistory = localStorage.getItem(
                "shoppingAssistant_conversationHistory"
            );
            if (oldHistory) {
                const parsed = JSON.parse(oldHistory);
                if (parsed.length > 0) {
                    const messages = parsed.map((msg) => ({
                        content: msg.parts[0].text,
                        type: msg.role === "user" ? "user" : "assistant",
                    }));
                    await this.saveMessages(messages, false);
                    localStorage.removeItem(
                        "shoppingAssistant_conversationHistory"
                    );
                }
            }
        } catch (error) {
            console.error("Error during migration:", error);
        }
    }
}

// Legacy classes for backward compatibility (will be removed in future)
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
        UnifiedConversationManager.clearConversation();
    } catch (error) {
        // Ignore errors during cleanup
    }
}
