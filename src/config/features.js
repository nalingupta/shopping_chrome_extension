export const FEATURES = {
    // When true, prefer static screen capture via chrome.tabs.captureVisibleTab
    // instead of the Chrome Debugger Page.captureScreenshot path.
    USE_STATIC_SCREEN_CAPTURE: true,
    // Frontend VAD for UI/orchestration only (does not gate audio transport)
    FRONTEND_VAD: {
        enabled: true,
        // Max-amplitude EMA thresholds with hysteresis; tuned for laptop/desktop mics
        startThreshold: 0.05, // speak start when EMA stays above this for minSpeechMs
        endThreshold: 0.03, // speak end when EMA stays below this for endSilenceMs
        // Debounce windows
        minSpeechMs: 250, // require this much sustained speech to start
        endSilenceMs: 600, // require this much silence to end
        // Smoothing
        emaAlpha: 0.2,
    },
};
export const DEFAULT_CAPTURE_FPS = 1;

// Mouse/hover capture configuration (centralized knobs)
export const MOUSE_CONFIG = {
    SAMPLE_INTERVAL_MS: 100, // mouse-event.js sampling tick
    BUCKET_FLUSH_MS: 500,   // activity-consumer.js bucket flush interval
};

// Tab info forwarding (ACTIVE mode only)
export const TAB_INFO_CONFIG = {
    RATE_MS: 1000,
};
