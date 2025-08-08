import { UnifiedConversationManager } from "./conversation-storage.js";
import { ChatStateManager } from "./chat-state-storage.js";

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

// Unified Storage Interface - maintains backward compatibility
export class UnifiedStorage {
    static async set(key, value) {
        return StorageManager.set(key, value);
    }

    static async get(key) {
        return StorageManager.get(key);
    }

    static async remove(key) {
        return StorageManager.remove(key);
    }

    static async clear() {
        return StorageManager.clear();
    }

    // Conversation storage delegation
    static async getConversation() {
        return UnifiedConversationManager.getConversation();
    }

    static async saveMessage(content, role, timestamp = Date.now()) {
        return UnifiedConversationManager.saveMessage(content, role, timestamp);
    }

    static async saveMessages(messages, isWelcomeVisible = false) {
        return UnifiedConversationManager.saveMessages(
            messages,
            isWelcomeVisible
        );
    }

    static async getMessagesForUI() {
        return UnifiedConversationManager.getMessagesForUI();
    }

    static async getContextForAPI() {
        return UnifiedConversationManager.getContextForAPI();
    }

    static async getWelcomeScreenState() {
        return UnifiedConversationManager.getWelcomeScreenState();
    }

    static async setWelcomeScreenState(isVisible) {
        return UnifiedConversationManager.setWelcomeScreenState(isVisible);
    }

    static async clearConversation() {
        return UnifiedConversationManager.clearConversation();
    }

    static async addConversationListener(callback) {
        return UnifiedConversationManager.addConversationListener(callback);
    }

    static broadcastConversationUpdate() {
        return UnifiedConversationManager.broadcastConversationUpdate();
    }

    static async migrateFromLocalStorage() {
        return UnifiedConversationManager.migrateFromLocalStorage();
    }

    // Chat state storage delegation
    static saveState(messages, isWelcomeVisible) {
        return ChatStateManager.saveState(messages, isWelcomeVisible);
    }

    static restoreState() {
        return ChatStateManager.restoreState();
    }

    static clearState() {
        return ChatStateManager.clearState();
    }
}
