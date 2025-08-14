export async function migrateFromLocalStorage(getConversation, saveMessages) {
    try {
        // Check if migration is needed
        const conversation = await getConversation();
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
                await saveMessages(parsed.messages, parsed.isWelcomeVisible);
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
                await saveMessages(messages, false);
                localStorage.removeItem(
                    "shoppingAssistant_conversationHistory"
                );
            }
        }
    } catch (error) {
        console.error("Error during migration:", error);
    }
}
