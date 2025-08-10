// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: "AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I",

    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,

    // ADK mode configuration (feature-flagged)
    ADK_MODE_ENABLED: true, // Turned on for testing; set false to use direct Gemini
    ADK_WS_URL: "ws://localhost:8080/ws/live",
    ADK_MODEL: "models/gemini-live-2.5-flash-preview",
};

// Validate API keys are present
if (!API_CONFIG.GEMINI_API_KEY) {
    console.error("Gemini API key missing in configuration");
}
