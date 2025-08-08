// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: "AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I",
    // Deepgram API key for transcription (use short-lived tokens in production)
    DEEPGRAM_API_KEY: "ffab3e437786226507991cda1120d07040ae14e7",

    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3,
};

// Validate API keys are present
if (!API_CONFIG.GEMINI_API_KEY) {
    console.error("Gemini API key missing in configuration");
}
if (!API_CONFIG.DEEPGRAM_API_KEY) {
    console.warn(
        "Deepgram API key missing; live transcription will be disabled"
    );
}
