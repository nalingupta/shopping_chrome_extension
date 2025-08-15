import { ShoppingAssistant } from "./core/app.js";
import { MOUSE_CONFIG } from "./config/features.js";

document.addEventListener("DOMContentLoaded", () => {
    const app = new ShoppingAssistant();
    try {
        // Expose for DevTools/testing only
        window.__app = app;
        // Provide config knobs to content scripts running in page context
        window.__MOUSE_SAMPLE_INTERVAL_MS__ = MOUSE_CONFIG.SAMPLE_INTERVAL_MS;
        window.__MOUSE_BUCKET_FLUSH_MS__ = MOUSE_CONFIG.BUCKET_FLUSH_MS;
    } catch (_) {}
});
