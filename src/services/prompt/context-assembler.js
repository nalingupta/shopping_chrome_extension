import { UnifiedConversationManager } from "../../utils/storage.js";

function formatText(value) {
    return String(value == null ? "" : value);
}

export class ContextAssembler {
    // Return canonical paired turns [{ user, assistant|null, userTs, assistantTs|null }]
    static async getCanonicalTurns({ beforeTs = null } = {}) {
        const conversation = await UnifiedConversationManager.getConversation();
        const messages = (conversation?.messages || [])
            .filter((m) => (beforeTs ? m.timestamp <= beforeTs : true))
            .map((m) => ({
                role: m.role === "model" ? "assistant" : m.role,
                text: formatText(m.content),
                ts: m.timestamp || 0,
            }));

        const turns = [];
        let pendingUser = null;
        let pendingUserTs = 0;

        for (const m of messages) {
            if (m.role === "user") {
                // Close previous in-progress user (no assistant)
                if (pendingUser !== null) {
                    turns.push({
                        user: pendingUser,
                        assistant: null,
                        userTs: pendingUserTs,
                        assistantTs: null,
                    });
                }
                pendingUser = m.text;
                pendingUserTs = m.ts;
            } else if (m.role === "assistant") {
                if (pendingUser !== null) {
                    turns.push({
                        user: pendingUser,
                        assistant: m.text,
                        userTs: pendingUserTs,
                        assistantTs: m.ts,
                    });
                    pendingUser = null;
                    pendingUserTs = 0;
                } else {
                    // Stray assistant; attach to previous if pending assistant missing
                    if (
                        turns.length > 0 &&
                        turns[turns.length - 1].assistant == null
                    ) {
                        turns[turns.length - 1].assistant = m.text;
                        turns[turns.length - 1].assistantTs = m.ts;
                    } else {
                        // Or create turn with empty user
                        turns.push({
                            user: "",
                            assistant: m.text,
                            userTs: 0,
                            assistantTs: m.ts,
                        });
                    }
                }
            }
        }
        if (pendingUser !== null) {
            turns.push({
                user: pendingUser,
                assistant: null,
                userTs: pendingUserTs,
                assistantTs: null,
            });
        }

        return turns;
    }

    // Flatten canonical turns to WS Live clientContent turns
    static flattenTurnsToWsContents(turns) {
        const contents = [];
        for (const t of turns) {
            if (t.user && t.user.length) {
                contents.push({ role: "user", parts: [{ text: t.user }] });
            }
            if (t.assistant && t.assistant.length) {
                contents.push({
                    role: "assistant",
                    parts: [{ text: t.assistant }],
                });
            }
        }
        return contents;
    }

    // Flatten canonical turns to REST contents (assistant→model)
    static flattenTurnsToRestContents(turns) {
        const contents = [];
        for (const t of turns) {
            if (t.user && t.user.length) {
                contents.push({ role: "user", parts: [{ text: t.user }] });
            }
            if (t.assistant && t.assistant.length) {
                contents.push({
                    role: "model",
                    parts: [{ text: t.assistant }],
                });
            }
        }
        return contents;
    }
}

export default ContextAssembler;
