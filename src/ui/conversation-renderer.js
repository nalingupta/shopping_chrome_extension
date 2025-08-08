// ConversationRenderer: Append-only, keyed, flicker-free conversation UI.
// Manages turn containers, live interim/streaming buffers, pending (Thinking...) state,
// and fixed-width bubbles. Persistence is delegated to callers via getHistory().

export class ConversationRenderer {
    constructor(messagesContainer) {
        this.messagesContainer = messagesContainer;

        // Append-only finalized history in UI format: { id, type (user|assistant), content, timestamp }
        this.history = [];

        // Live buffers for the current turn
        this.currentTurnElement = null; // container for the current turn
        this.userInterim = null; // { textNode, text, lastLength }
        this.assistantStream = null; // { textNode, text, lastLength, hasStarted, caretEl, pendingEl }

        // Anchor behavior: when a new turn begins, anchor that turn to the top
        this.isAnchoredToCurrentTurn = false;

        // Rendering pacing
        this.tokenFlushHandle = null;
    }

    // Public API -----------------------------------------------------------

    restore(messages) {
        // Stable, append-only hydration using sequence comparison
        const normalized = (messages || []).map((m) => ({
            type: m.type,
            content: m.content,
            timestamp: m.timestamp || 0,
            id: m.id || null,
        }));

        if (this.history.length === 0) {
            for (const msg of normalized) {
                const withId = {
                    id:
                        msg.id ||
                        `${msg.type}-${this.history.length}-${Date.now()}`,
                    type: msg.type,
                    content: msg.content,
                    timestamp: msg.timestamp || Date.now(),
                };
                this.history.push(withId);
                this.#appendFinalizedMessage(withId);
            }
            return;
        }

        // Verify prefix equality by content+type to avoid duplicates on broadcast
        const minLen = Math.min(this.history.length, normalized.length);
        for (let i = 0; i < minLen; i++) {
            const a = this.history[i];
            const b = normalized[i];
            if (!a || !b || a.type !== b.type || a.content !== b.content) {
                // Divergence detected; to stay non-destructive, stop syncing
                // (prevents duplicates). A full rehydrate can be added later if needed.
                return;
            }
        }

        // Append any messages beyond current history length
        for (let i = this.history.length; i < normalized.length; i++) {
            const src = normalized[i];
            const withId = {
                id: src.id || `${src.type}-${i}-${Date.now()}`,
                type: src.type,
                content: src.content,
                timestamp: src.timestamp || Date.now(),
            };
            this.history.push(withId);
            this.#appendFinalizedMessage(withId);
        }
    }

    setUserInterim(text) {
        // If an assistant stream is active (previous turn), force a new turn for this interim
        if (this.assistantStream) {
            this.currentTurnElement = null;
        }

        // Ensure a current turn exists for this interim
        if (!this.currentTurnElement) {
            this.#createNewTurn();
        }

        // If userInterim not created, create stable bubble and text node
        if (!this.userInterim) {
            const bubble = this.#createBubble("user", { live: true });
            this.currentTurnElement.appendChild(bubble);

            const textNode = document.createTextNode("");
            bubble.querySelector(".message-content").appendChild(textNode);
            this.userInterim = { textNode, text: "", lastLength: 0 };
        }

        this.#appendDelta(this.userInterim, text);
    }

    finalizeUserInterim(finalText) {
        if (!finalText) return;

        // Ensure interim exists and flush content
        if (!this.currentTurnElement) {
            this.#createNewTurn();
        }
        if (!this.userInterim) {
            // Create and fill directly if interim did not exist
            const bubble = this.#createBubble("user", { live: true });
            this.currentTurnElement.appendChild(bubble);
            const textNode = document.createTextNode("");
            bubble.querySelector(".message-content").appendChild(textNode);
            this.userInterim = { textNode, text: "", lastLength: 0 };
        }

        this.#appendDelta(this.userInterim, finalText);

        // Convert to finalized user message in history
        const content = this.userInterim.textNode.data;
        const userMsg = {
            id: `user-${Date.now()}`,
            type: "user",
            content,
            timestamp: Date.now(),
        };
        this.history.push(userMsg);

        // Replace live class with finalized
        const userBubble = this.userInterim.textNode.parentElement.closest(
            ".message.user-message"
        );
        if (userBubble) userBubble.classList.remove("live");

        // Clear interim buffer
        this.userInterim = null;

        // Prepare assistant bubble with pending state and anchor
        this.#ensureAssistantPending();
        this.#anchorCurrentTurnToTop();
    }

    startAssistantStream() {
        if (!this.currentTurnElement) {
            this.#createNewTurn();
        }
        this.#ensureAssistantPending();
    }

    updateAssistantStream(fullText) {
        if (!fullText) return;
        if (!this.currentTurnElement) {
            this.#createNewTurn();
        }

        // Ensure assistant structures exist
        this.#ensureAssistantPending();
        this.#ensureAssistantTextNode();

        // Hide pending label on first token
        if (!this.assistantStream.hasStarted) {
            this.assistantStream.hasStarted = true;
            if (this.assistantStream.pendingEl) {
                this.assistantStream.pendingEl.classList.add("hidden");
            }
        }

        this.#appendDelta(this.assistantStream, fullText);
    }

    finalizeAssistantStream() {
        if (!this.assistantStream) {
            return;
        }

        // Finalize message
        const content = this.assistantStream.textNode?.data || "";
        const asstMsg = {
            id: `assistant-${Date.now()}`,
            type: "assistant",
            content,
            timestamp: Date.now(),
        };
        this.history.push(asstMsg);

        // Cleanup caret and pending
        const bubble = this.assistantStream.textNode?.parentElement?.closest(
            ".message.assistant-message"
        );
        if (bubble) {
            bubble.classList.remove("live");
            const caret = bubble.querySelector(".caret");
            if (caret) caret.remove();
            const pending = bubble.querySelector(".thinking");
            if (pending) pending.remove();
        }

        const finishedTurn =
            this.assistantStream.turnEl || this.currentTurnElement;
        this.assistantStream = null;
        if (this.currentTurnElement === finishedTurn) {
            this.currentTurnElement = null;
        }
        this.isAnchoredToCurrentTurn = false;
    }

    reset() {
        // Clear UI and state
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = "";
        }
        this.history = [];
        this.currentTurnElement = null;
        this.userInterim = null;
        this.assistantStream = null;
        this.isAnchoredToCurrentTurn = false;
        if (this.tokenFlushHandle) cancelAnimationFrame(this.tokenFlushHandle);
        this.tokenFlushHandle = null;
    }

    getHistory() {
        // Return history in UI format expected by storage: { content, type }
        return this.history.map((m) => ({ content: m.content, type: m.type }));
    }

    appendFinalMessage(type, content) {
        // Public helper to append a finalized message directly (no live buffers)
        const msg = {
            id: `${type}-${Date.now()}`,
            type,
            content,
            timestamp: Date.now(),
        };
        this.history.push(msg);
        this.#appendFinalizedMessage(msg);
    }

    startNewTurnWithFinalUser(content) {
        // Begin a new turn anchored to top, with a finalized user message and a pending assistant bubble
        this.#createNewTurn();

        // Create finalized user bubble
        const userBubble = this.#createBubble("user", { live: false });
        userBubble.querySelector(".message-content").textContent = content;
        this.currentTurnElement.appendChild(userBubble);

        // Push to history
        const userMsg = {
            id: `user-${Date.now()}`,
            type: "user",
            content,
            timestamp: Date.now(),
        };
        this.history.push(userMsg);

        // Prepare assistant pending and anchor
        this.#ensureAssistantPending();
        this.#anchorCurrentTurnToTop();
    }

    // Internal helpers -----------------------------------------------------

    #createNewTurn() {
        const turn = document.createElement("div");
        turn.className = "turn";
        this.messagesContainer.appendChild(turn);
        this.currentTurnElement = turn;
    }

    #createBubble(type, { live = false } = {}) {
        const wrapper = document.createElement("div");
        wrapper.className = `message ${type}-message${live ? " live" : ""}`;

        const content = document.createElement("div");
        content.className = "message-content fixed-width";
        content.setAttribute("dir", "auto");
        wrapper.appendChild(content);

        return wrapper;
    }

    #ensureAssistantPending() {
        // If assistant bubble exists already, no-op
        if (this.assistantStream && this.assistantStream.textNode) return;

        // Ensure current turn
        if (!this.currentTurnElement) {
            this.#createNewTurn();
        }

        // Create assistant bubble if absent
        let bubble = this.currentTurnElement.querySelector(
            ".message.assistant-message"
        );
        if (!bubble) {
            bubble = this.#createBubble("assistant", { live: true });
            this.currentTurnElement.appendChild(bubble);
        }

        // Add pending "Thinking…" indicator if not present
        let pending = bubble.querySelector(".thinking");
        if (!pending) {
            pending = document.createElement("span");
            pending.className = "thinking";
            pending.textContent = "Thinking…";
            bubble.querySelector(".message-content").appendChild(pending);
        }

        // Ensure caret exists but keep it after text
        let caret = bubble.querySelector(".caret");
        if (!caret) {
            caret = document.createElement("span");
            caret.className = "caret";
            caret.textContent = "▋";
            bubble.querySelector(".message-content").appendChild(caret);
        }

        // Initialize assistant stream state (text node created lazily)
        if (!this.assistantStream) {
            this.assistantStream = {
                textNode: null,
                text: "",
                lastLength: 0,
                hasStarted: false,
                caretEl: caret,
                pendingEl: pending,
                turnEl: this.currentTurnElement,
            };
        } else {
            this.assistantStream.caretEl = caret;
            this.assistantStream.pendingEl = pending;
            if (!this.assistantStream.turnEl) {
                this.assistantStream.turnEl = this.currentTurnElement;
            }
        }
    }

    #ensureAssistantTextNode() {
        if (this.assistantStream && !this.assistantStream.textNode) {
            const bubble = this.currentTurnElement.querySelector(
                ".message.assistant-message .message-content"
            );
            if (!bubble) return;
            const caret = this.assistantStream.caretEl;
            const textNode = document.createTextNode("");
            // Insert before the caret so caret remains at the end
            bubble.insertBefore(textNode, caret || null);
            this.assistantStream.textNode = textNode;
        }
    }

    #appendFinalizedMessage(msg) {
        // Append a finalized message bubble into the container
        const bubble = this.#createBubble(msg.type, { live: false });
        bubble.querySelector(".message-content").textContent = msg.content;
        this.messagesContainer.appendChild(bubble);
    }

    #appendDelta(buffer, fullText) {
        if (!buffer || typeof fullText !== "string") return;

        // Compute delta based on lastLength
        const nextLen = fullText.length;
        const delta =
            nextLen > buffer.lastLength
                ? fullText.slice(buffer.lastLength)
                : "";
        buffer.text = fullText;
        buffer.lastLength = nextLen;

        if (!delta) return;

        // Tokenize delta into words and spaces to stream smoothly
        const tokens = this.#tokenize(delta);

        // Immediate append of the whole delta to minimize perceived latency
        const targetNode = buffer.textNode;
        if (!targetNode) return;
        targetNode.appendData(delta);
    }

    #tokenize(text) {
        // Split on word boundaries while preserving spaces and punctuation
        // Example: "Hello, world!" -> ["Hello", ",", " ", "world", "!"]
        const result = [];
        let current = "";
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (/\s/.test(ch)) {
                if (current) {
                    result.push(current);
                    current = "";
                }
                result.push(ch);
            } else if (/[,.;:!?]/.test(ch)) {
                if (current) {
                    result.push(current);
                    current = "";
                }
                result.push(ch);
            } else {
                current += ch;
            }
        }
        if (current) result.push(current);
        return result;
    }

    #anchorCurrentTurnToTop() {
        if (!this.currentTurnElement || !this.messagesContainer) return;
        const container = this.messagesContainer;

        // Align current turn's top to container's top without smooth scrolling
        const top = this.currentTurnElement.offsetTop - container.offsetTop;
        container.scrollTop = top;
        this.isAnchoredToCurrentTurn = true;
    }
}
