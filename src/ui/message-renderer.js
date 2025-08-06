export class MessageRenderer {
    static debouncedUpdateTimeout = null;
    static lastInterimContent = "";
    static pendingInterimUpdate = "";
    static lastStreamingContent = ""; // Track last streaming content

    static createMessage(content, type, isLoading = false) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${type}-message`;

        const contentDiv = document.createElement("div");
        contentDiv.className = `message-content ${isLoading ? "loading" : ""}`;
        contentDiv.textContent = content;

        messageDiv.appendChild(contentDiv);

        return messageDiv;
    }

    static createInterimMessage(content) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message user-message interim-message";
        messageDiv.id = "interim-message";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content interim-content";
        contentDiv.textContent = content;

        messageDiv.appendChild(contentDiv);

        this.lastInterimContent = content;
        return messageDiv;
    }

    static updateInterimMessage(content) {
        // Store the pending update
        this.pendingInterimUpdate = content;

        // Clear existing timeout
        if (this.debouncedUpdateTimeout) {
            clearTimeout(this.debouncedUpdateTimeout);
        }

        // Only update if content has meaningfully changed
        if (this.shouldUpdateInterim(content)) {
            // Debounce updates to reduce flickering
            this.debouncedUpdateTimeout = setTimeout(() => {
                this.performInterimUpdate(this.pendingInterimUpdate);
            }, 150); // 150ms debounce
        }
    }

    static shouldUpdateInterim(newContent) {
        // Don't update if content is the same
        if (newContent === this.lastInterimContent) {
            return false;
        }

        // Don't update for very small changes (single character additions)
        if (
            this.lastInterimContent &&
            newContent.length - this.lastInterimContent.length === 1 &&
            newContent.startsWith(this.lastInterimContent)
        ) {
            // Allow single character additions but debounce them more
            if (this.debouncedUpdateTimeout) {
                clearTimeout(this.debouncedUpdateTimeout);
            }
            this.debouncedUpdateTimeout = setTimeout(() => {
                this.performInterimUpdate(this.pendingInterimUpdate);
            }, 300); // Longer debounce for small changes
            return false;
        }

        return true;
    }

    static performInterimUpdate(content) {
        const interimMessage = document.getElementById("interim-message");
        if (interimMessage && content !== this.lastInterimContent) {
            const contentDiv = interimMessage.querySelector(".message-content");
            if (contentDiv) {
                // Add smooth transition class
                contentDiv.classList.add("updating");

                // Update content
                contentDiv.textContent = content;
                this.lastInterimContent = content;

                // Remove transition class after animation
                setTimeout(() => {
                    contentDiv.classList.remove("updating");
                }, 200);
            }
        }
    }

    static createStreamingMessage(content = "") {
        // Clear any existing streaming message first
        this.clearStreamingMessage();

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message streaming-message";
        messageDiv.id = "streaming-message";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content streaming-content";
        contentDiv.textContent = content;

        // Add typing indicator
        const typingIndicator = document.createElement("span");
        typingIndicator.className = "typing-indicator";
        typingIndicator.textContent = "▋";
        contentDiv.appendChild(typingIndicator);

        messageDiv.appendChild(contentDiv);

        this.lastStreamingContent = content;
        return messageDiv;
    }

    static updateStreamingMessage(content) {
        // Don't update if content hasn't changed
        if (content === this.lastStreamingContent) {
            return;
        }

        const streamingMessage = document.getElementById("streaming-message");
        if (streamingMessage) {
            const contentDiv =
                streamingMessage.querySelector(".message-content");
            if (contentDiv) {
                // Update content
                contentDiv.textContent = content;
                this.lastStreamingContent = content;

                // Add typing indicator back
                const typingIndicator = document.createElement("span");
                typingIndicator.className = "typing-indicator";
                typingIndicator.textContent = "▋";
                contentDiv.appendChild(typingIndicator);
            }
        }
    }

    static finalizeStreamingMessage() {
        const streamingMessage = document.getElementById("streaming-message");
        if (streamingMessage) {
            // Remove typing indicator and convert to regular message
            const contentDiv =
                streamingMessage.querySelector(".message-content");
            if (contentDiv) {
                contentDiv.classList.remove("streaming-content");
                // Remove typing indicator
                const typingIndicator =
                    contentDiv.querySelector(".typing-indicator");
                if (typingIndicator) {
                    typingIndicator.remove();
                }
            }
            streamingMessage.classList.remove("streaming-message");
            streamingMessage.removeAttribute("id");
        }
    }

    static clearInterimMessage() {
        // Clear any pending updates
        if (this.debouncedUpdateTimeout) {
            clearTimeout(this.debouncedUpdateTimeout);
            this.debouncedUpdateTimeout = null;
        }

        const interimMessage = document.getElementById("interim-message");
        if (interimMessage) {
            interimMessage.remove();
        }

        // Reset state
        this.lastInterimContent = "";
        this.pendingInterimUpdate = "";
    }

    static clearStreamingMessage() {
        const streamingMessage = document.getElementById("streaming-message");
        if (streamingMessage) {
            streamingMessage.remove();
        }
        this.lastStreamingContent = "";
    }

    static forceUpdateInterimMessage(content) {
        // Force immediate update without debouncing (for final transcriptions)
        if (this.debouncedUpdateTimeout) {
            clearTimeout(this.debouncedUpdateTimeout);
            this.debouncedUpdateTimeout = null;
        }
        this.performInterimUpdate(content);
    }
}
