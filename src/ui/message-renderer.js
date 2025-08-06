export class MessageRenderer {
    static debouncedUpdateTimeout = null;
    static lastInterimContent = "";
    static pendingInterimUpdate = "";
    static currentStreamingMessageId = null; // Track the current streaming message
    static streamingUpdateQueue = []; // Queue for streaming updates to prevent flickering
    static isProcessingStreamingUpdate = false;
    static lastStreamingContent = ""; // Track last content to prevent unnecessary updates

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

        console.log("Creating new streaming message with content:", content);

        const messageDiv = document.createElement("div");
        messageDiv.className = "message assistant-message streaming-message";
        messageDiv.id = "streaming-message";

        // Generate unique ID for this streaming message
        const streamingId = `streaming-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        messageDiv.dataset.streamingId = streamingId;
        this.currentStreamingMessageId = streamingId;
        this.lastStreamingContent = content;

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content streaming-content";

        // Create a single text node for content
        const textNode = document.createTextNode(content);
        contentDiv.appendChild(textNode);

        // Add typing indicator as a separate element
        const typingIndicator = document.createElement("span");
        typingIndicator.className = "typing-indicator";
        typingIndicator.textContent = "▋";
        contentDiv.appendChild(typingIndicator);

        messageDiv.appendChild(contentDiv);

        console.log("Created streaming message with ID:", streamingId);
        return messageDiv;
    }

    static updateStreamingMessage(content) {
        // Don't update if content hasn't changed
        if (content === this.lastStreamingContent) {
            return;
        }

        // Queue the update to prevent rapid DOM manipulation
        this.streamingUpdateQueue.push(content);

        if (!this.isProcessingStreamingUpdate) {
            // Use requestAnimationFrame for smoother updates
            requestAnimationFrame(() => {
                this.processStreamingUpdateQueue();
            });
        }
    }

    static processStreamingUpdateQueue() {
        if (this.streamingUpdateQueue.length === 0) {
            this.isProcessingStreamingUpdate = false;
            return;
        }

        this.isProcessingStreamingUpdate = true;

        // Get the latest content from the queue
        const latestContent =
            this.streamingUpdateQueue[this.streamingUpdateQueue.length - 1];
        this.streamingUpdateQueue = []; // Clear the queue

        const streamingMessage = document.getElementById("streaming-message");
        if (
            streamingMessage &&
            streamingMessage.dataset.streamingId ===
                this.currentStreamingMessageId
        ) {
            console.log(
                "Updating streaming message with content:",
                latestContent
            );
            const contentDiv =
                streamingMessage.querySelector(".message-content");
            if (contentDiv) {
                // Find the text node and update it directly
                const textNode = contentDiv.firstChild;
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    // Only update if content actually changed
                    if (textNode.textContent !== latestContent) {
                        textNode.textContent = latestContent;
                        this.lastStreamingContent = latestContent;
                    }
                } else {
                    // Fallback: update the entire content
                    contentDiv.textContent = latestContent;
                    this.lastStreamingContent = latestContent;

                    // Add typing indicator back
                    const typingIndicator = document.createElement("span");
                    typingIndicator.className = "typing-indicator";
                    typingIndicator.textContent = "▋";
                    contentDiv.appendChild(typingIndicator);
                }
            }
        } else {
            console.log(
                "Streaming message not found or ID mismatch. Current ID:",
                this.currentStreamingMessageId
            );
        }

        // Process next update using requestAnimationFrame for smoother performance
        requestAnimationFrame(() => {
            this.processStreamingUpdateQueue();
        });
    }

    static finalizeStreamingMessage() {
        const streamingMessage = document.getElementById("streaming-message");
        if (
            streamingMessage &&
            streamingMessage.dataset.streamingId ===
                this.currentStreamingMessageId
        ) {
            console.log("Finalizing streaming message");

            // Clear any pending updates
            this.streamingUpdateQueue = [];
            this.isProcessingStreamingUpdate = false;

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
            streamingMessage.removeAttribute("data-streaming-id");

            // Clear the current streaming message ID
            this.currentStreamingMessageId = null;
            this.lastStreamingContent = "";
            console.log("Streaming message finalized");
        } else {
            console.log(
                "Cannot finalize streaming message - not found or ID mismatch"
            );
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
        this.currentStreamingMessageId = null;
        this.streamingUpdateQueue = [];
        this.isProcessingStreamingUpdate = false;
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
