// API Configuration for local development
export const API_CONFIG = {
    // Backend server endpoints (Phase 1)
    SERVER_WS_URL: "ws://127.0.0.1:8787/ws",
    SERVER_HTTP_URL: "http://127.0.0.1:8787",

    // Connection settings
    CONNECTION_TIMEOUT: 30000, // 30 seconds
    RETRY_ATTEMPTS: 3, // 0 = unlimited

    // Reconnect backoff
    BACKOFF_INITIAL_MS: 500,
    BACKOFF_MAX_MS: 15000,
    BACKOFF_MULTIPLIER: 2,
    BACKOFF_JITTER_MS: 250,

    // Liveness
    LIVENESS_TIMEOUT_MS: 15000,
    LIVENESS_CHECK_INTERVAL_MS: 5000,

    // Client send queue (non-media messages only)
    PENDING_QUEUE_MAX: 50,
};
