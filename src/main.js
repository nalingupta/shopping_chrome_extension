import { ShoppingAssistant } from "./core/app.js";

document.addEventListener("DOMContentLoaded", () => {
    const app = new ShoppingAssistant();
    try {
        // Expose for DevTools/testing only
        window.__app = app;
    } catch (_) {}
});
