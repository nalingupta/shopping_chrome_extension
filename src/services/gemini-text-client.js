import { API_CONFIG } from "../config/api-keys.js";
import { UnifiedConversationManager } from "../utils/storage.js";
import { SYSTEM_PROMPT } from "../prompt/system-prompt.js";
import { ContextAssembler } from "./prompt/context-assembler.js";
import { streamingLogger } from "../utils/streaming-logger.js";

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

            // Emit TurnSummary for REST (channel=REST, modality=text)
            const screenBytes = (() => {
                const b64 = pageInfo?.screenCapture?.split(",")[1];
                if (!b64) return 0;
                const len = b64.length;
                const padding = b64.endsWith("==")
                    ? 2
                    : b64.endsWith("=")
                    ? 1
                    : 0;
                return Math.floor((len * 3) / 4) - padding;
            })();
            const screenSize = streamingLogger.formatBytes(screenBytes);
            const buildHistoryLine = () => {
                try {
                    const snap = Array.isArray(historyContents)
                        ? historyContents
                        : [];
                    if (snap.length === 0)
                        return "[TextClient] History | empty";
                    const counts = snap.reduce(
                        (acc, t) => (
                            (acc[t.role] = (acc[t.role] || 0) + 1), acc
                        ),
                        {}
                    );
                    const previews = [];
                    if (snap.length <= 2) {
                        snap.forEach((t, i) => {
                            const text = (t?.parts?.[0]?.text || "").slice(
                                0,
                                60
                            );
                            previews.push(
                                `${i}:${t.role}=${JSON.stringify(text)}`
                            );
                        });
                    } else if (snap.length === 3) {
                        const first = snap[0];
                        const last = snap[2];
                        previews.push(
                            `first0:${first.role}=${JSON.stringify(
                                (first?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                        previews.push(
                            `last0:${last.role}=${JSON.stringify(
                                (last?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                    } else {
                        const first0 = snap[0];
                        const first1 = snap[1];
                        const last1 = snap[snap.length - 2];
                        const last0 = snap[snap.length - 1];
                        previews.push(
                            `first0:${first0.role}=${JSON.stringify(
                                (first0?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                        previews.push(
                            `first1:${first1.role}=${JSON.stringify(
                                (first1?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                        previews.push(
                            `last1:${last1.role}=${JSON.stringify(
                                (last1?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                        previews.push(
                            `last0:${last0.role}=${JSON.stringify(
                                (last0?.parts?.[0]?.text || "").slice(0, 60)
                            )}`
                        );
                    }
                    return `[TextClient] History | turns=${
                        snap.length
                    } roles user=${counts.user || 0} assistant=${
                        counts.assistant || 0
                    } | previews ${previews.join(" ")}`;
                } catch (_) {
                    return "[TextClient] History | unavailable";
                }
            };
            const userPreview = JSON.stringify(
                (contextText || "").slice(0, 120)
            );
            const outputPreview = JSON.stringify(
                (primaryText || "").slice(0, 120)
            );
            // Line 1: Summary
            console.debug(
                `[TextClient] TurnSummary | channel=REST | modality=text | session=- turn=- | audio=0 chunks, 0 B | screens=${
                    pageInfo?.screenCapture ? 1 : 0
                } frame, ${screenSize}`
            );
            // Line 2: History
            console.debug(buildHistoryLine());
            // Line 3: User
            console.debug(
                `[TextClient] User | len=${
                    (contextText || "").length
                } | ${userPreview}`
            );
            // Line 4: Output
            console.debug(
                `[TextClient] Output | len=${primaryText.length} | ${outputPreview}`
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
