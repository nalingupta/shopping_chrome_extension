// Configuration example for Cartesia API
// Copy this file to config.js and add your actual API key
const CONFIG = {
    CARTESIA_API_KEY: "sk_car_GnQKiX8dix844iL4D4eFuU",
    CARTESIA_STT_MODEL: "ink-whisper-v1.0",
};

// Export for use in extension
if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
}
