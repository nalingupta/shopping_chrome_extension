import { API_CONFIG } from "../config/api-keys.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { SYSTEM_PROMPT } from "../prompt/system-prompt.js";
import { ContextAssembler } from "./prompt/context-assembler.js";

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

        // Build unified context (full history, mapped to Gemini roles) and a concise context block
        const { contents: historyContents, contextText } =
            await ContextAssembler.buildContext({
                currentTranscript: query,
                currentPageInfo: pageInfo,
            });

        try {
            console.debug(
                `[TextClient] Context built: history=${
                    historyContents?.length || 0
                }, contextTextLen=${contextText?.length || 0}`
            );
        } catch (_) {}

        // Call Gemini API with shared prompt and assembled context
        const response = await this.callGeminiAPI({
            systemPrompt: SYSTEM_PROMPT,
            historyContents,
            contextText,
            pageInfo,
        });

        // Save user message to unified conversation history
        await UnifiedConversationManager.saveMessage(query, "user");

        // Save assistant response to unified conversation history
        await UnifiedConversationManager.saveMessage(response, "assistant");

        return response;
    }

    static async callGeminiAPI({
        systemPrompt,
        historyContents,
        contextText,
        pageInfo,
    }) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_CONFIG.GEMINI_API_KEY}`;
        // Build contents: full mapped history + current user context block (+ image if available)
        const contents = [...(historyContents || [])];
        const userParts = [{ text: contextText }];
        if (pageInfo?.screenCapture) {
            const base64Data = pageInfo.screenCapture.split(",")[1];
            if (base64Data) {
                userParts.push({
                    inlineData: { mimeType: "image/jpeg", data: base64Data },
                });
            }
        }
        contents.push({ role: "user", parts: userParts });

        const requestBody = {
            contents,
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            },
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            console.debug(
                `[TextClient] Request: contents=${contents.length}, userParts=${
                    userParts.length
                }, hasSystemInstruction=${!!systemPrompt}`
            );
        } catch (_) {}

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        try {
            console.debug(`[TextClient] HTTP status: ${response.status}`);
        } catch (_) {}

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Gemini API error: ${response.status} - ${errorText}`
            );
        }

        const data = await response.json();

        try {
            const candidate = data?.candidates?.[0]?.content;
            const parts = candidate?.parts || [];
            const primaryText = parts?.[0]?.text || "";
            const totalLen = parts.reduce(
                (acc, p) => acc + (p?.text ? p.text.length : 0),
                0
            );
            console.debug(
                `[TextClient] Parsed response: candidates=${
                    data?.candidates?.length || 0
                }, parts=${parts.length}, primaryLen=${
                    primaryText.length
                }, totalPartsTextLen=${totalLen}`
            );
        } catch (_) {}

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
