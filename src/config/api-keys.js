// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: 'AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I',
    
    // Daily API key for WebRTC streaming
    DAILY_API_KEY: '6eba5c1efdcbfa1f34ac368e04fcdef024e7332b05b3cc4c68a8ba42d389ac25',
    
    // Pipecat Cloud configuration - DEPLOYED AGENT!
    PIPECAT_CLOUD_API_URL: 'https://api.pipecat.daily.co/v1/public',
    PIPECAT_PUBLIC_API_KEY: 'pk_f5da8750-94c2-4287-9bdb-28b94ebd334d', // Public API key (stable, no expiration)
    PIPECAT_AGENT_NAME: 'shopping-assistant', // Your deployed agent
    
    // Real-time streaming enabled by default
    ENABLE_REAL_TIME_STREAMING: true,
    
    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3
};

// Validate API keys are present
if (!API_CONFIG.GEMINI_API_KEY || !API_CONFIG.DAILY_API_KEY || !API_CONFIG.PIPECAT_JWT_TOKEN) {
    console.error('❌ API keys missing in configuration');
} else {
    console.log('✅ All API keys configured for deployed agent');
}