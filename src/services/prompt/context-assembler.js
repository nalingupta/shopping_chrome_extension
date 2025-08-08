import { UnifiedConversationManager } from "../../utils/storage.js";

function mapStoredRoleToGeminiRole(role) {
    // Stored roles are "user" | "assistant"; Gemini expects "user" | "model"
    if (role === "assistant") return "model";
    return "user";
}

export class ContextAssembler {
    // Build only the mapped conversation history (no page metadata or interims)
    static async buildHistoryContents() {
        const conversation = await UnifiedConversationManager.getConversation();
        const contents = (conversation?.messages || []).map((msg) => ({
            role: mapStoredRoleToGeminiRole(msg.role),
            parts: [{ text: String(msg.content || "") }],
        }));
        return contents;
    }
}

export default ContextAssembler;
