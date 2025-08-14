// Returns a sanitized copy of the conversation with final-only paired turns
// Does not perform any storage writes or broadcasts
export function sanitizeConversation(conversation) {
    try {
        const messages = Array.isArray(conversation?.messages)
            ? conversation.messages
            : [];
        if (messages.length === 0) return conversation;

        const norm = (s) => (s || "").replace(/[\s\u00A0]+/g, " ").trim();

        const turns = [];
        let pendingUser = null;
        for (const m of messages) {
            const role = m.role === "model" ? "assistant" : m.role;
            const text = norm(m.content || "");
            if (!text) continue;
            if (role === "user") {
                if (pendingUser !== null) {
                    turns.push({ user: pendingUser, assistant: null });
                }
                pendingUser = text;
            } else if (role === "assistant") {
                if (pendingUser !== null) {
                    turns.push({ user: pendingUser, assistant: text });
                    pendingUser = null;
                } else if (turns.length > 0) {
                    const last = turns[turns.length - 1];
                    if (last.assistant == null) {
                        last.assistant = text;
                    } else {
                        last.assistant = `${last.assistant} ${text}`.trim();
                    }
                } else {
                    // leading assistant with no user
                    turns.push({ user: "", assistant: text });
                }
            }
        }
        if (pendingUser !== null) {
            turns.push({ user: pendingUser, assistant: null });
        }

        const rebuilt = [];
        for (const t of turns) {
            const u = norm(t.user || "");
            const a = norm(t.assistant || "");
            if (u)
                rebuilt.push({
                    role: "user",
                    content: u,
                    timestamp: Date.now(),
                });
            if (a)
                rebuilt.push({
                    role: "assistant",
                    content: a,
                    timestamp: Date.now(),
                });
        }

        // If no changes, return original
        const sameLength = rebuilt.length === messages.length;
        const sameAll =
            sameLength &&
            rebuilt.every(
                (r, i) =>
                    r.role === messages[i].role &&
                    norm(r.content) === norm(messages[i].content)
            );
        if (sameAll) return conversation;

        return {
            messages: rebuilt,
            lastUpdated: Date.now(),
            isWelcomeVisible: conversation?.isWelcomeVisible ?? true,
        };
    } catch (e) {
        return (
            conversation || {
                messages: [],
                lastUpdated: Date.now(),
                isWelcomeVisible: true,
            }
        );
    }
}
