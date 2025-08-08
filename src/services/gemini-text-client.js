import { API_CONFIG } from "../config/api-keys.js";
import { UnifiedConversationManager } from "../utils/storage.js";

export class GeminiTextClient {
    static async processQuery(data) {
        const { query, pageInfo } = data;

        try {
            const response = await this.generateGeminiResponse(query, pageInfo);
            return { success: true, response };
        } catch (error) {
            console.error("❌ Gemini API error:", error);
            return {
                success: false,
                response:
                    "I'm sorry, I encountered an error while processing your request. Please try again.",
            };
        }
    }

    static async generateGeminiResponse(query, pageInfo) {
        if (!API_CONFIG.GEMINI_API_KEY) {
            throw new Error("Gemini API key not configured");
        }

        // Load conversation history for context using unified manager
        const conversationHistory =
            await UnifiedConversationManager.getContextForAPI();

        // Prepare the multimodal request
        const messages = [];

        // System prompt for shopping assistant
        const systemPrompt = `You are an AI shopping assistant that helps users with product recommendations, price comparisons, and shopping decisions. You can see what the user is looking at on their screen and respond accordingly.

Key capabilities:
- Analyze products visible on screen
- Compare prices and features
- Recommend similar or alternative products
- Explain product details and specifications
- Help with shopping decisions
- Analyze reviews and ratings

Always be helpful, concise, and focus on the user's shopping needs.`;

        messages.push({
            role: "system",
            content: systemPrompt,
        });

        // Add conversation history as previous turns
        if (conversationHistory.length > 0) {
            console.log(
                `🧠 GeminiTextClient: Including ${conversationHistory.length} conversation history messages`
            );
            conversationHistory.forEach((turn) => {
                messages.push({
                    role: turn.role,
                    content: turn.parts[0].text,
                });
            });
        }

        // User message with text and optional screen capture
        const userContent = [];

        // Add text
        userContent.push({
            type: "text",
            text: `User query: "${query}"\n\nPage context: ${
                pageInfo?.title || "Unknown page"
            } at ${pageInfo?.url || "Unknown URL"}`,
        });

        // Add screen capture if available
        if (pageInfo?.screenCapture) {
            userContent.push({
                type: "image_url",
                image_url: {
                    url: pageInfo.screenCapture,
                },
            });
        }

        messages.push({
            role: "user",
            content: userContent,
        });

        // Call Gemini API
        const response = await this.callGeminiAPI(messages);

        // Save user message to unified conversation history
        await UnifiedConversationManager.saveMessage(query, "user");

        // Save assistant response to unified conversation history
        await UnifiedConversationManager.saveMessage(response, "assistant");

        return response;
    }

    static async callGeminiAPI(messages) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_CONFIG.GEMINI_API_KEY}`;

        // Convert messages to Gemini format
        const contents = messages
            .filter((msg) => msg.role !== "system")
            .map((msg) => ({
                role: msg.role === "user" ? "user" : "model",
                parts: Array.isArray(msg.content)
                    ? msg.content.map((part) => {
                          if (part.type === "text") {
                              return { text: part.text };
                          } else if (part.type === "image_url") {
                              // Convert base64 image to Gemini format
                              const base64Data =
                                  part.image_url.url.split(",")[1];
                              return {
                                  inlineData: {
                                      mimeType: "image/jpeg",
                                      data: base64Data,
                                  },
                              };
                          }
                          return part;
                      })
                    : [{ text: msg.content }],
            }));

        // Add system instruction
        const systemMessage = messages.find((msg) => msg.role === "system");
        const requestBody = {
            contents: contents,
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
        };

        if (systemMessage) {
            requestBody.systemInstruction = {
                parts: [{ text: systemMessage.content }],
            };
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Gemini API error: ${response.status} - ${errorText}`
            );
        }

        const data = await response.json();

        if (
            !data.candidates ||
            !data.candidates[0] ||
            !data.candidates[0].content
        ) {
            throw new Error("Invalid response from Gemini API");
        }

        return data.candidates[0].content.parts[0].text;
    }
}
