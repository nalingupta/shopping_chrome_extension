import { UnifiedConversationManager } from "../../utils/storage.js";

function mapStoredRoleToGeminiRole(role) {
    // Stored roles are "user" | "assistant"; Gemini expects "user" | "model"
    if (role === "assistant") return "model";
    return "user";
}

export class ContextAssembler {
    // Build full conversation in Gemini "contents" format and a compact context text
    static async buildContext({
        currentTranscript = "",
        currentPageInfo = null,
    } = {}) {
        // 1) Get stored conversation and map roles to Gemini format
        const conversation = await UnifiedConversationManager.getConversation();
        const contents = (conversation?.messages || []).map((msg) => ({
            role: mapStoredRoleToGeminiRole(msg.role),
            parts: [{ text: String(msg.content || "") }],
        }));

        // 2) Use provided page metadata (sourced by content script/broadcast)
        const pageInfo = currentPageInfo || null;

        // 3) Create a concise, structured context block combining transcript + page metadata
        const lines = ["[context_v1]"];
        if (currentTranscript && currentTranscript.trim()) {
            lines.push(
                `user_transcript: ${JSON.stringify(currentTranscript.trim())}`
            );
        }
        if (pageInfo) {
            const safePage = {
                url: pageInfo.url,
                title: pageInfo.title,
                domain: pageInfo.domain,
                siteInfo: pageInfo.siteInfo,
                description: pageInfo.description,
                ogTitle: pageInfo.ogTitle,
            };
            lines.push(`page: ${JSON.stringify(safePage)}`);
        }

        const contextText = lines.join("\n");

        return { contents, contextText };
    }
}

export default ContextAssembler;
