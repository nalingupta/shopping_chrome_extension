// API Configuration - Hardcoded for production use
export const API_CONFIG = {
    // Gemini API key for AI processing
    GEMINI_API_KEY: 'AIzaSyBZNwOelWAZowrj2nUJaarQrF1R_goyu1I',
    
    // Daily API key for WebRTC streaming
    DAILY_API_KEY: '6eba5c1efdcbfa1f34ac368e04fcdef024e7332b05b3cc4c68a8ba42d389ac25',
    
    // Pipecat Cloud configuration - DEPLOYED AGENT!
    PIPECAT_CLOUD_API_URL: 'https://api.pipecat.daily.co/v1',
    PIPECAT_JWT_TOKEN: 'eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDIyMkFBQSIsImtpZCI6Imluc18yc0RSZEtMbFpwdXl6N29KNHo5VUowMzNMaTUiLCJ0eXAiOiJKV1QifQ.eyJleHAiOjE3NTQzODg1MjksImlhdCI6MTc1NDMwMjEyOSwiaXNzIjoiaHR0cHM6Ly9jbGVyay5waXBlY2F0LmRhaWx5LmNvIiwianRpIjoiMDhjYTIzYTU3Y2ZhODE1YzQ0OTUiLCJuYmYiOjE3NTQzMDIxMjQsInN1YiI6InVzZXJfMzBrRlFKZDVNOXU3RVQyYlRXVU85Q1dVa1dDIiwidXNlcl9pZCI6InVzZXJfMzBrRlFKZDVNOXU3RVQyYlRXVU85Q1dVa1dDIn0.jmXVbfcOz7scEgm9QJgq-7PviAbdhjOz-bCrBZ8lrpe2KXP_XirRWtBdtqBCqm7y0NLZ0HUm97q7QSzSv_6cxG3FNB-wuC9uSFCGSX2wQ8rQamG1xivEvNCDCXycL1-RfwJgThps5nmbxyrnhloOrtwZIJL6xti2A6Cgh5TnKR3jJ3M58xYAD0MHauNKf2sIjB5Sx7z4dMjjNJElAPD0TPwQvdXN_jUScrfq5nlKMYbCZUcUIskZmm3J0Uk0hK6x_WBayPlmjmeZVVvyfCrk76XPcD3XeCRbtNQ73-eh-2IXtdqvf2sL8dwJXfMtMZ7CI4VCP19zvDIU-EArnZae6w', // JWT token from CLI
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