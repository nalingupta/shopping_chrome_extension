// Debug flags for non-critical logging. Keep required logs unaffected.
// Default false to ensure no behavior change unless explicitly enabled.
export const DEBUG_MEDIA = false;
// Group per-frame media debug logs to keep console readable when DEBUG_MEDIA is true
export const DEBUG_MEDIA_GROUP = false;
export const DEBUG_MEDIA_GROUP_INTERVAL_MS = 250; // flush roughly every 250ms
export const DEBUG_MEDIA_GROUP_MAX = 64; // or when this many frames are buffered
// Lightweight VAD transition logs (independent of media frame logs)
export const DEBUG_FRONTEND_VAD = false;

// Background/service worker debug logs (kept off by default)
export const DEBUG_BACKGROUND_LOGS = false;
export const DEBUG_HOVER_LOGS = false;
