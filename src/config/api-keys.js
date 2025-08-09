// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: "AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I",

    // Deepgram API key for live transcription
    DEEPGRAM_API_KEY: "5151d8dfa74e9e298e49f5852bc1d9f881868778",

    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
};

// Validate API keys are present
if (!API_CONFIG.GEMINI_API_KEY) {
    console.error("Gemini API key missing in configuration");
}
if (!API_CONFIG.DEEPGRAM_API_KEY) {
    console.error("Deepgram API key missing in configuration");
}
