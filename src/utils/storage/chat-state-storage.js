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
