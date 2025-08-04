class ShoppingAssistant {
    constructor() {
        this.messagesContainer = document.getElementById("messages");
        this.userInput = document.getElementById("userInput");
        this.sendButton = document.getElementById("sendButton");
        this.voiceButton = document.getElementById("voiceButton");
        this.siteUrl = document.getElementById("siteUrl");
        this.suggestionsContainer = document.getElementById("suggestions");

        this.currentPageInfo = null;
        this.isProcessing = false;

        // Initialize voice input handler
        this.voiceHandler = new VoiceInputHandler();

        // Set up callback for when transcription is received
        this.voiceHandler.setTranscriptionCallback((transcription) => {
            this.handleTranscriptionReceived(transcription);
        });

        // Set up callback for interim results (live transcription)
        this.voiceHandler.setInterimCallback((interimText) => {
            this.handleInterimTranscription(interimText);
        });

        // Remove conversation end callback - not needed anymore

        this.initializeEventListeners();
        this.getCurrentPageInfo();
    }

    initializeEventListeners() {
        this.sendButton.addEventListener("click", () =>
            this.handleSendMessage()
        );

        this.voiceButton.addEventListener("click", () =>
            this.handleVoiceInput()
        );

        this.userInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        this.userInput.addEventListener("input", () => {
            this.adjustTextareaHeight();
        });

        this.suggestionsContainer.addEventListener("click", (e) => {
            if (e.target.classList.contains("suggestion-chip")) {
                const suggestion = e.target.dataset.suggestion;
                this.userInput.value = suggestion;
                this.handleSendMessage();
            }
        });

        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (request.type === "PAGE_INFO_BROADCAST") {
                    this.updatePageInfo(request.data);
                }

                // Note: Audio data is now handled directly in voiceInput.js via callback
            }
        );
    }

    adjustTextareaHeight() {
        this.userInput.style.height = "auto";
        this.userInput.style.height =
            Math.min(this.userInput.scrollHeight, 80) + "px";
    }

    async getCurrentPageInfo() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: "GET_CURRENT_TAB_INFO" },
                    resolve
                );
            });

            if (response) {
                this.updatePageInfo(response);
            }
        } catch (error) {
            console.error("Error getting current page info:", error);
            this.siteUrl.textContent = "Unable to detect current page";
        }
    }

    updatePageInfo(pageInfo) {
        this.currentPageInfo = pageInfo;

        if (pageInfo.siteInfo) {
            const siteDisplay =
                pageInfo.siteInfo.name === "General Site"
                    ? pageInfo.domain
                    : pageInfo.siteInfo.name;
            this.siteUrl.textContent = siteDisplay;
        } else {
            this.siteUrl.textContent = pageInfo.domain || "Unknown site";
        }

        this.updateSuggestions(pageInfo);
    }

    updateSuggestions(pageInfo) {
        const suggestions =
            this.suggestionsContainer.querySelectorAll(".suggestion-chip");

        if (pageInfo.siteInfo?.type === "shopping") {
            suggestions[0].dataset.suggestion = "Tell me about this product";
            suggestions[1].dataset.suggestion = "Find similar products";
            suggestions[2].dataset.suggestion = "Compare prices";
            suggestions[3].dataset.suggestion = "Check reviews and ratings";
        } else {
            suggestions[0].dataset.suggestion = "Help me find products";
            suggestions[1].dataset.suggestion = "Show me shopping sites";
            suggestions[2].dataset.suggestion = "Find deals and discounts";
            suggestions[3].dataset.suggestion = "Product recommendations";
        }
    }

    async handleSendMessage() {
        const message = this.userInput.value.trim();
        if (!message || this.isProcessing) return;

        this.addMessage(message, "user");
        this.userInput.value = "";
        this.adjustTextareaHeight();

        this.isProcessing = true;
        this.sendButton.disabled = true;

        const loadingMessage = this.addMessage(
            "Thinking...",
            "assistant",
            true
        );

        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    {
                        type: "PROCESS_USER_QUERY",
                        data: {
                            query: message,
                            pageInfo: this.currentPageInfo,
                        },
                    },
                    resolve
                );
            });

            this.removeMessage(loadingMessage);

            if (response.success) {
                this.addMessage(response.response, "assistant");
            } else {
                this.addMessage(
                    response.response ||
                        "Sorry, I encountered an error. Please try again.",
                    "assistant"
                );
            }
        } catch (error) {
            console.error("Error processing message:", error);
            this.removeMessage(loadingMessage);
            this.addMessage(
                "Sorry, I encountered an error. Please try again.",
                "assistant"
            );
        } finally {
            this.isProcessing = false;
            this.sendButton.disabled = false;
            this.userInput.focus();
        }
    }

    addMessage(content, type, isLoading = false) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `message ${type}-message`;

        const contentDiv = document.createElement("div");
        contentDiv.className = `message-content ${isLoading ? "loading" : ""}`;
        contentDiv.textContent = content;

        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);

        this.scrollToBottom();

        return messageDiv;
    }

    removeMessage(messageElement) {
        if (messageElement && messageElement.parentNode) {
            messageElement.parentNode.removeChild(messageElement);
        }
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    async handleVoiceInput() {
        if (this.voiceHandler.isListening) {
            // Stop listening
            this.voiceButton.classList.remove("listening");
            this.voiceButton.title = "Click to start voice conversation";
            await this.voiceHandler.stopListening();
            
            // Clear any interim text
            this.clearInterimText();
            
            // Show stop message
            this.addMessage("🔇 Voice conversation stopped. Click the microphone to start again.", "assistant");
        } else {
            // Start listening
            const result = await this.voiceHandler.startListening();
            if (result.success) {
                this.voiceButton.classList.add("listening");
                this.voiceButton.title = "Click to stop voice conversation";
                
                // Show start message
                this.addMessage("🎙️ Voice conversation started! I'm listening - start speaking anytime.", "assistant");
            } else {
                // Handle specific error types
                let errorMessage = "";
                switch (result.error) {
                    case "permission_denied":
                        errorMessage =
                            result.help ||
                            "Microphone access denied. Please allow microphone permissions for this extension.\n\n" +
                                "To fix: Click the extension icon in the toolbar → Site settings → Allow microphone access.";
                        break;
                    case "permission_dismissed":
                        errorMessage =
                            result.help ||
                            "Microphone permission was dismissed. Please click the microphone button again and allow access when prompted.";
                        // Add retry button if canRetry is true
                        if (result.canRetry) {
                            try {
                                this.addRetryButton();
                            } catch (error) {
                                console.error(
                                    "Error adding retry button:",
                                    error
                                );
                                // Continue without the retry button
                            }
                        }
                        break;
                    case "permission_dismissed_max_retries":
                        errorMessage =
                            result.help ||
                            "Microphone permission was dismissed multiple times. Please try:\n1. Click the microphone icon in the address bar\n2. Select 'Allow' for microphone access\n3. Refresh the page and try again";
                        break;
                    case "no_microphone":
                        errorMessage =
                            result.help ||
                            "No microphone found. Please connect a microphone and try again.";
                        break;
                    case "not_supported":
                        errorMessage =
                            result.help ||
                            "Voice input is not supported in this browser context. Please try updating Chrome.";
                        break;
                    case "tab_capture_failed":
                        errorMessage =
                            result.help ||
                            "Voice input is not available on this page. Please try:\n" +
                                "• Navigating to a different website\n" +
                                "• Using text input instead\n" +
                                "• Refreshing the page and trying again";
                        break;
                    case "unsupported_protocol":
                        errorMessage =
                            "Voice input requires a website with HTTP or HTTPS protocol. Please navigate to a regular website.";
                        break;
                    case "no_active_tab":
                        errorMessage =
                            "No active tab found. Please refresh the page and try again.";
                        break;
                    case "extension_recording_failed":
                        errorMessage =
                            "Extension recording failed. Please try refreshing the page and try again.";
                        break;

                    case "not_secure_context":
                        errorMessage =
                            "Microphone access requires a secure website (HTTPS). Please navigate to a secure website.";
                        break;
                    case "getusermedia_not_supported":
                        errorMessage =
                            "Microphone access not supported in this context. Please try updating Chrome.";
                        break;
                    default:
                        errorMessage =
                            result.help ||
                            "Unable to access microphone. Error: " +
                                (result.details || result.error);
                }
                this.addMessage(errorMessage, "assistant");
            }
        }
    }

    handleTranscriptionReceived(transcription) {
        if (transcription) {
            // Clear any interim text
            this.clearInterimText();

            // Check if this is an error message
            if (transcription.includes("Speech recognition failed") || 
                transcription.includes("Error processing audio")) {
                // Show the error message as an assistant message
                this.addMessage(transcription, "assistant");
                return;
            }

            // Always add user message directly and process
            this.addMessage(transcription, "user");
            this.processVoiceMessage(transcription);
        }
    }

    handleInterimTranscription(interimText) {
        if (interimText && this.voiceHandler.isListening) {
            // Show interim text in a special way
            this.showInterimText(interimText);
        }
    }

    showInterimText(text) {
        // Remove any existing interim message
        this.clearInterimText();

        // Add interim message
        const messageDiv = document.createElement("div");
        messageDiv.className = "message user-message interim-message";
        messageDiv.id = "interim-message";

        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content interim-content";
        contentDiv.textContent = text + " ...";
        contentDiv.style.opacity = "0.7";
        contentDiv.style.fontStyle = "italic";

        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
    }

    clearInterimText() {
        const interimMessage = document.getElementById("interim-message");
        if (interimMessage) {
            interimMessage.remove();
        }
    }

    async processVoiceMessage(message) {
        // Notify voice handler that we're processing a response
        this.voiceHandler.notifyResponseProcessing(true);

        this.isProcessing = true;
        this.sendButton.disabled = true;

        const loadingMessage = this.addMessage(
            "Thinking...",
            "assistant",
            true
        );

        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    {
                        type: "PROCESS_USER_QUERY",
                        data: {
                            query: message,
                            pageInfo: this.currentPageInfo,
                        },
                    },
                    resolve
                );
            });

            this.removeMessage(loadingMessage);

            if (response.success) {
                this.addMessage(response.response, "assistant");
            } else {
                this.addMessage(
                    response.response ||
                        "Sorry, I encountered an error. Please try again.",
                    "assistant"
                );
            }
        } catch (error) {
            console.error("Error processing message:", error);
            this.removeMessage(loadingMessage);
            this.addMessage(
                "Sorry, I encountered an error. Please try again.",
                "assistant"
            );
        } finally {
            this.isProcessing = false;
            this.sendButton.disabled = false;
            
            // Notify voice handler that response processing is complete
            this.voiceHandler.notifyResponseProcessing(false);
        }
    }

    // Conversation end handler removed - using simple toggle now

    generateMockResponse(userMessage) {
        // Show loading state
        const loadingMessage = this.addMessage(
            "Processing your request...",
            "assistant",
            true
        );

        // Simulate API delay
        setTimeout(() => {
            this.removeMessage(loadingMessage);

            // Generate contextual mock response based on user input
            const mockResponse = this.getMockResponseForQuery(userMessage);
            this.addMessage(mockResponse, "assistant");
        }, 1500);
    }

    getMockResponseForQuery(query) {
        const lowerQuery = query.toLowerCase();

        if (lowerQuery.includes("price") || lowerQuery.includes("cost")) {
            return "Based on my analysis, this product is currently priced at $49.99, which is 15% below the average market price. I've found similar items ranging from $55-$75.";
        } else if (lowerQuery.includes("deal") || lowerQuery.includes("sale")) {
            return 'Great news! This item is currently on sale with a 20% discount. The sale ends in 3 days. I also found a coupon code "SAVE10" for an additional 10% off.';
        } else if (
            lowerQuery.includes("similar") ||
            lowerQuery.includes("alternative")
        ) {
            return "I found 5 similar products:\n1. Product A - $45 (4.5★)\n2. Product B - $52 (4.7★)\n3. Product C - $48 (4.3★)\nWould you like more details about any of these?";
        } else if (
            lowerQuery.includes("review") ||
            lowerQuery.includes("rating")
        ) {
            return "This product has a 4.6/5 star rating based on 1,234 reviews. Users praise its durability and value for money. Main complaints are about shipping delays.";
        } else if (lowerQuery.includes("compare")) {
            return "Comparing with top competitors:\n• This product: $49.99, 4.6★, Free shipping\n• Competitor A: $55.99, 4.4★, $5 shipping\n• Competitor B: $52.99, 4.5★, Free shipping\nThis appears to be the best value option.";
        } else {
            return "I'm analyzing the current page for shopping insights. Based on what I see, this looks like a quality product with competitive pricing. Would you like me to check for better deals or similar items?";
        }
    }

    addRetryButton() {
        // Create a retry button for permission issues
        const retryButton = document.createElement("button");
        retryButton.textContent = "🔄 Try Again";
        retryButton.className = "retry-button";
        retryButton.style.cssText = `
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 8px;
            font-size: 14px;
        `;

        retryButton.addEventListener("click", async () => {
            retryButton.textContent = "⏳ Requesting...";
            retryButton.disabled = true;

            // Try to start recording again
            const result = await this.voiceHandler.startRecording();
            if (result.success) {
                this.voiceButton.classList.add("recording");
                this.voiceButton.querySelector(".voice-icon").textContent =
                    "🔴";
                // Remove the retry button
                retryButton.remove();
            } else {
                // Show the error again
                this.addMessage(
                    result.help ||
                        "Failed to start recording. Please try again.",
                    "assistant"
                );
                retryButton.textContent = "🔄 Try Again";
                retryButton.disabled = false;
            }
        });

        // Add the retry button to the last message - use the correct container reference
        try {
            if (this.messagesContainer) {
                const messages =
                    this.messagesContainer.querySelectorAll(".message");
                const lastMessage = messages[messages.length - 1];
                if (lastMessage) {
                    lastMessage.appendChild(retryButton);
                } else {
                    // Fallback: add to the messages container directly
                    this.messagesContainer.appendChild(retryButton);
                }
            } else {
                // Fallback: try to find messages container by ID
                const messagesContainer = document.getElementById("messages");
                if (messagesContainer) {
                    const messages =
                        messagesContainer.querySelectorAll(".message");
                    const lastMessage = messages[messages.length - 1];
                    if (lastMessage) {
                        lastMessage.appendChild(retryButton);
                    } else {
                        messagesContainer.appendChild(retryButton);
                    }
                }
            }
        } catch (error) {
            console.error("Error adding retry button:", error);
            // Fallback: just show the error message without the button
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new ShoppingAssistant();
});
