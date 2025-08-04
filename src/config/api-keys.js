// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: 'AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I',
    
    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3
};

// Validate API keys are present
if (!API_CONFIG.GEMINI_API_KEY) {
    console.error('Gemini API key missing in configuration');
}