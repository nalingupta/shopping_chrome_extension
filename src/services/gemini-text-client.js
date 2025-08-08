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

        // Build canonical turns and then REST-friendly history contents
        const turns = await ContextAssembler.getCanonicalTurns();
        const historyContents =
            ContextAssembler.flattenTurnsToRestContents(turns);
        const contextText = query;

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
                `[TextClient] Request: contents=${
                    requestBody.contents.length
                }, hasSystemInstruction=${!!systemPrompt}`
            );
            // Build canonical history from the exact payload we send, then normalize+dedupe for logs
            const rawPairs = [];
            let pendingUser = null;
            for (const c of requestBody.contents) {
                const role = c.role === "model" ? "assistant" : c.role;
                const text = (c?.parts?.[0]?.text || "").trim();
                if (role === "user") {
                    if (pendingUser !== null)
                        rawPairs.push({ user: pendingUser, assistant: null });
                    pendingUser = text;
                } else if (role === "assistant") {
                    if (pendingUser !== null) {
                        rawPairs.push({ user: pendingUser, assistant: text });
                        pendingUser = null;
                    } else if (
                        rawPairs.length > 0 &&
                        rawPairs[rawPairs.length - 1].assistant == null
                    ) {
                        rawPairs[rawPairs.length - 1].assistant = text;
                    } else {
                        rawPairs.push({ user: "", assistant: text });
                    }
                }
            }
            if (pendingUser !== null)
                rawPairs.push({ user: pendingUser, assistant: null });
            const norm = (s) => (s || "").trim();
            const pairs = [];
            for (const t of rawPairs) {
                const last = pairs[pairs.length - 1];
                const same =
                    last &&
                    norm(last.user) === norm(t.user) &&
                    norm(last.assistant || "") === norm(t.assistant || "");
                if (!same) pairs.push(t);
            }
            const n = pairs.length;
            if (n === 0) {
                console.debug("[TextClient] History | empty");
            } else if (n === 1) {
                const f = pairs[0];
                console.debug(
                    `[TextClient] History | turns=1 | first: user=${JSON.stringify(
                        (f.user || "").slice(0, 60)
                    )} assistant=${
                        f.assistant == null
                            ? "(pending)"
                            : JSON.stringify((f.assistant || "").slice(0, 60))
                    }`
                );
            } else {
                const f = pairs[0];
                const l = pairs[n - 1];
                console.debug(
                    `[TextClient] History | turns=${n} | first: user=${JSON.stringify(
                        (f.user || "").slice(0, 60)
                    )} assistant=${
                        f.assistant == null
                            ? "(pending)"
                            : JSON.stringify((f.assistant || "").slice(0, 60))
                    } | ... | last: user=${JSON.stringify(
                        (l.user || "").slice(0, 60)
                    )} assistant=${
                        l.assistant == null
                            ? "(pending)"
                            : JSON.stringify((l.assistant || "").slice(0, 60))
                    }`
                );
            }
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
            const sHdr = "color:#6a1b9a;font-weight:bold"; // purple
            const sLbl = "color:#00838f;font-weight:bold"; // teal
            const sUser = "color:#1e88e5;font-weight:bold"; // blue
            const sAsst = "color:#2e7d32;font-weight:bold"; // green
            console.debug(`%c[TextClient] Turn`, sHdr);
            console.debug(
                `%cSummary:%c [REST | text | screens=${
                    pageInfo?.screenCapture ? 1 : 0
                } frame${pageInfo?.screenCapture ? "" : "s"} (${screenSize})]`,
                sLbl,
                ""
            );
            console.debug(
                `%cUser:%c ${JSON.stringify(
                    (contextText || "").slice(0, 120)
                )}`,
                sUser,
                ""
            );
            console.debug(
                `%cOutput:%c ${JSON.stringify(
                    (primaryText || "").slice(0, 120)
                )}`,
                sAsst,
                ""
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
