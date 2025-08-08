// TurnView: stateless renderer for turns and bubbles.
// Operates with idempotent "ensure" and "update" methods; no destructive clears.

export class TurnView {
    constructor(messagesContainer) {
        this.messagesContainer = messagesContainer;
    }

    // Helpers
    #ensureRow(id) {
        let row = document.getElementById(id);
        if (!row) {
            row = document.createElement("div");
            row.className = "turn";
            row.id = id;
            this.messagesContainer.appendChild(row);
        }
        return row;
    }

    #ensureMessage(row, type) {
        let message = row.querySelector(`.message.${type}-message`);
        if (!message) {
            message = document.createElement("div");
            message.className = `message ${type}-message`;
            message.setAttribute("data-type", type);
            message.style.width = "100%"; // row stretches full width
            message.style.display = "flex";
            message.style.justifyContent =
                type === "user" ? "flex-end" : "flex-start";

            const bubble = document.createElement("div");
            bubble.className = "message-content bubble";
            // Fixed width bubble via CSS var
            bubble.style.width = "var(--bubbleWidthPx)";
            bubble.style.maxWidth = "var(--bubbleWidthPx)";
            bubble.style.whiteSpace = "pre-wrap";
            bubble.style.display = "block";
            bubble.style.overflowWrap = "break-word";
            bubble.setAttribute("dir", "auto");

            message.appendChild(bubble);
            row.appendChild(message);
        }
        return message;
    }

    ensureTurn(id) {
        this.#ensureRow(id);
    }

    ensureUserInterim(id) {
        const row = this.#ensureRow(id);
        const message = this.#ensureMessage(row, "user");
        let textNode = message.querySelector(".bubble > .text-node");
        if (!textNode) {
            const tn = document.createTextNode("");
            tn.className = "text-node"; // harmless on Text node
            message.querySelector(".bubble")?.appendChild(tn) ||
                message.lastChild.appendChild(tn);
        }
    }

    updateUserInterim(id, fullText) {
        const row = document.getElementById(id);
        if (!row) return;
        const bubble =
            row.querySelector(".message.user-message .bubble") ||
            row.querySelector(".message.user-message .message-content");
        if (!bubble) return;
        // Keep a single text node; append delta
        if (!bubble.firstChild) bubble.appendChild(document.createTextNode(""));
        const tn = bubble.firstChild;
        const prev = tn.data || "";
        // Append only the delta to minimize work
        if (fullText.startsWith(prev)) {
            tn.appendData(fullText.slice(prev.length));
        } else {
            tn.data = fullText;
        }
    }

    finalizeUser(id, finalText) {
        const row = this.#ensureRow(id);
        const message = this.#ensureMessage(row, "user");
        const bubble =
            message.querySelector(".bubble") ||
            message.querySelector(".message-content");
        if (!bubble.firstChild) bubble.appendChild(document.createTextNode(""));
        bubble.firstChild.data = finalText;
    }

    ensureAssistantPending(id) {
        const row = this.#ensureRow(id);
        const message = this.#ensureMessage(row, "assistant");
        const bubble =
            message.querySelector(".bubble") ||
            message.querySelector(".message-content");
        let thinking = bubble.querySelector(".thinking");
        if (!thinking) {
            thinking = document.createElement("span");
            thinking.className = "thinking";
            thinking.textContent = "Thinking…";
            bubble.appendChild(thinking);
        }
        let caret = bubble.querySelector(".caret");
        if (!caret) {
            caret = document.createElement("span");
            caret.className = "caret";
            caret.textContent = "▋";
            bubble.appendChild(caret);
        }
        // Ensure text node before caret
        let tn = null;
        for (const n of bubble.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) {
                tn = n;
                break;
            }
        }
        if (!tn) {
            tn = document.createTextNode("");
            bubble.insertBefore(tn, caret);
        }
    }

    updateAssistantStream(id, fullText) {
        const row = document.getElementById(id);
        if (!row) return;
        const bubble =
            row.querySelector(".message.assistant-message .bubble") ||
            row.querySelector(".message.assistant-message .message-content");
        if (!bubble) return;
        // Hide thinking label on first token
        const thinking = bubble.querySelector(".thinking");
        if (thinking) thinking.classList.add("hidden");
        // Find text node
        let tn = null;
        for (const n of bubble.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) {
                tn = n;
                break;
            }
        }
        if (!tn) {
            tn = document.createTextNode("");
            const caret = bubble.querySelector(".caret");
            bubble.insertBefore(tn, caret);
        }
        const prev = tn.data || "";
        if (fullText.startsWith(prev)) {
            tn.appendData(fullText.slice(prev.length));
        } else {
            tn.data = fullText;
        }
    }

    finalizeAssistant(id) {
        const row = document.getElementById(id);
        if (!row) return;
        const bubble =
            row.querySelector(".message.assistant-message .bubble") ||
            row.querySelector(".message.assistant-message .message-content");
        if (!bubble) return;
        const caret = bubble.querySelector(".caret");
        if (caret) caret.remove();
        const thinking = bubble.querySelector(".thinking");
        if (thinking) thinking.remove();
    }

    snapToTop(id) {
        const row = document.getElementById(id);
        if (!row) return;
        const container = this.messagesContainer;

        const getScrollable = () => {
            const c = container;
            const canScroll = c && c.scrollHeight - c.clientHeight > 1;
            if (canScroll) return c;
            const doc = document.scrollingElement || document.documentElement;
            return doc;
        };

        const computeTopRelativeTo = (scroller) => {
            if (!scroller) return 0;
            if (
                scroller === document.scrollingElement ||
                scroller === document.documentElement
            ) {
                const rect = row.getBoundingClientRect();
                return (
                    (scroller.scrollTop || window.pageYOffset || 0) + rect.top
                );
            }
            // Sum offsetTop up to scroller
            let el = row;
            let top = 0;
            while (el && el !== scroller) {
                top += el.offsetTop || 0;
                el = el.offsetParent;
            }
            const cs = getComputedStyle(scroller);
            const padTop = parseFloat(cs.paddingTop) || 0;
            const borderTop = parseFloat(cs.borderTopWidth) || 0;
            return Math.max(0, top - padTop - borderTop);
        };

        // Snap after layout has settled to avoid race with DOM writes
        const snap = () => {
            const scroller = getScrollable();
            const targetTop = computeTopRelativeTo(scroller);
            const before = scroller.scrollTop;
            // First try native snap on the row
            try {
                row.scrollIntoView({
                    block: "start",
                    inline: "nearest",
                    behavior: "auto",
                });
            } catch (_) {}
            // Then explicitly set scrollTop on the chosen scroller
            scroller.scrollTop = targetTop;
            const after = scroller.scrollTop;
            // Debug logs to verify behavior
            try {
                console.debug(
                    "[Snap] scroller=",
                    scroller === container ? "#messages" : "document",
                    {
                        canScroll:
                            scroller.scrollHeight - scroller.clientHeight,
                        before,
                        targetTop,
                        after,
                    }
                );
            } catch (_) {}
            // Re-assert shortly after in case of late reflow
            setTimeout(() => {
                scroller.scrollTop = targetTop;
            }, 30);
        };
        // Two rAFs to ensure styles/height are applied
        requestAnimationFrame(() => requestAnimationFrame(snap));
    }
}
