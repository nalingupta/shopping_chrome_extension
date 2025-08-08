// ConversationController: state machine for utterance turns.
// Drives the renderer with declarative, idempotent calls.

export class ConversationController {
    constructor(view) {
        this.view = view; // TurnView-like API
        this.turns = []; // { id, user: { text, finalized }, assistant: { text, status } }
        this.activeTurnId = null;
        this.anchorTurnId = null;
    }

    // Utilities
    #createTurn() {
        const id = `turn-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        const turn = {
            id,
            user: { text: "", finalized: false },
            assistant: { text: "", status: "idle" },
        };
        this.turns.push(turn);
        this.activeTurnId = id;
        this.view.ensureTurn(id);
        return id;
    }

    #getTurn(id) {
        return this.turns.find((t) => t.id === id);
    }

    // Public API
    onInterim(text) {
        // Start a new turn at the first interim if no active turn or the last turn is not a fresh interim
        if (!this.activeTurnId) {
            this.#createTurn();
        }
        const turn = this.#getTurn(this.activeTurnId);
        if (!turn) return;
        if (turn.user.finalized) {
            // Safety: if somehow the active turn is already finalized, start new
            this.#createTurn();
        }
        const active = this.#getTurn(this.activeTurnId);
        active.user.text = text;
        this.view.ensureUserInterim(this.activeTurnId);
        this.view.updateUserInterim(this.activeTurnId, text);
    }

    onUserFinal(finalText) {
        if (!this.activeTurnId) {
            this.#createTurn();
        }
        const turn = this.#getTurn(this.activeTurnId);
        if (!turn) return;
        try {
            console.log("[Final] turn=", this.activeTurnId, {
                prevUserText: turn.user.text,
                prevAssistantStatus: turn.assistant.status,
            });
        } catch (_) {}
        turn.user.text = finalText;
        turn.user.finalized = true;
        this.view.finalizeUser(this.activeTurnId, finalText);

        // Assistant pending and snap anchor
        turn.assistant.status = "pending";
        this.view.ensureAssistantPending(this.activeTurnId);

        this.anchorTurnId = this.activeTurnId;
        this.view.snapToTop(this.anchorTurnId);
    }

    onAssistantStream(fullText) {
        // Ensure we have an anchor. If none, bind to the current active turn (user may still be interim),
        // or create a new one if nothing exists yet. This allows WS streaming to show even before user finalizes.
        if (!this.anchorTurnId) {
            if (!this.activeTurnId) {
                this.#createTurn();
            }
            this.anchorTurnId = this.activeTurnId;
        }

        const id = this.anchorTurnId;
        const turn = this.#getTurn(id);
        if (!turn) return;
        if (turn.assistant.status === "idle") {
            turn.assistant.status = "pending";
            this.view.ensureAssistantPending(id);
        }
        if (turn.assistant.status === "pending") {
            turn.assistant.status = "streaming";
        }
        turn.assistant.text = fullText;
        this.view.updateAssistantStream(id, fullText);
    }

    onAssistantFinal() {
        const id = this.anchorTurnId;
        if (!id) return;
        const turn = this.#getTurn(id);
        if (!turn) return;
        turn.assistant.status = "final";
        this.view.finalizeAssistant(id);
        this.anchorTurnId = null;
        this.activeTurnId = null;
    }

    // Persistence helpers
    getPersistableMessages() {
        // Flatten to [{type, content}] in order
        const out = [];
        for (const t of this.turns) {
            if (t.user.finalized && t.user.text)
                out.push({ type: "user", content: t.user.text });
            if (t.assistant.status === "final" && t.assistant.text)
                out.push({ type: "assistant", content: t.assistant.text });
        }
        return out;
    }
}
