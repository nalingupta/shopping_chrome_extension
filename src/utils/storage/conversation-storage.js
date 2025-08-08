import { MESSAGE_TYPES } from "../constants.js";

export class UnifiedConversationManager {
    static CONVERSATION_KEY = "shoppingAssistant_conversation";
    static MAX_HISTORY_LENGTH = 50; // Keep last 50 messages
    static MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

    static async getConversation() {
        try {
            // Prefer local storage for conversation
            const localResult = await chrome.storage.local.get([
                this.CONVERSATION_KEY,
            ]);
            let conversation = localResult[this.CONVERSATION_KEY];

            // If not present locally, try to migrate from sync → local
            if (!conversation) {
                const syncResult = await chrome.storage.sync.get([
                    this.CONVERSATION_KEY,
                ]);
                const syncConversation = syncResult[this.CONVERSATION_KEY];
                if (syncConversation) {
                    conversation = syncConversation;
                    try {
                        await chrome.storage.local.set({
                            [this.CONVERSATION_KEY]: conversation,
                        });
                        await chrome.storage.sync.remove([
                            this.CONVERSATION_KEY,
                        ]);
                        this.broadcastConversationUpdate();
                    } catch (migrateErr) {
                        console.error(
                            "Error migrating conversation from sync to local:",
                            migrateErr
                        );
                    }
                }
            }

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

            await chrome.storage.local.set({
                [this.CONVERSATION_KEY]: conversation,
            });

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

            await chrome.storage.local.set({
                [this.CONVERSATION_KEY]: conversation,
            });

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

            await chrome.storage.local.set({
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
            await chrome.storage.local.remove([this.CONVERSATION_KEY]);

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
                if (namespace === "local" && changes[this.CONVERSATION_KEY]) {
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
