// Lightweight .env loader for Chrome extension pages (MV3, ESM)
// - Loads ".env" packaged with the extension using fetch(chrome.runtime.getURL(".env"))
// - Caches parsed variables in-memory
// - Provides convenient typed getters with sensible defaults

const ENV_CACHE = {
    loaded: false,
    vars: {},
    loadingPromise: null,
};

function parseEnvText(text) {
    const result = {};
    if (typeof text !== "string" || !text.trim()) return result;

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        // Simple KEY=VALUE parsing; allow values with '=' by splitting once
        const idx = line.indexOf("=");
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        // Strip surrounding quotes if present
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key) {
            result[key] = value;
        }
    }
    return result;
}

async function loadEnvInner() {
    try {
        const url = chrome.runtime.getURL(".env");
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) {
            // .env not present or not readable; use empty set
            return {};
        }
        const text = await res.text();
        return parseEnvText(text);
    } catch (_) {
        // Ignore errors; fall back to empty env
        return {};
    }
}

export async function loadEnv() {
    if (ENV_CACHE.loaded) return ENV_CACHE.vars;
    if (!ENV_CACHE.loadingPromise) {
        ENV_CACHE.loadingPromise = (async () => {
            const vars = await loadEnvInner();
            ENV_CACHE.vars = vars || {};
            ENV_CACHE.loaded = true;
            return ENV_CACHE.vars;
        })();
    }
    return ENV_CACHE.loadingPromise;
}

export async function getEnvString(key, defaultValue = "") {
    const env = await loadEnv();
    const val = env?.[key];
    return typeof val === "string" && val.length > 0 ? val : defaultValue;
}

export async function getEnvBoolean(key, defaultValue = false) {
    const raw = await getEnvString(key, "");
    if (!raw) return !!defaultValue;
    const v = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off"].includes(v)) return false;
    return !!defaultValue;
}

export async function getEnvNumber(key, defaultValue = 0) {
    const raw = await getEnvString(key, "");
    if (!raw) return Number(defaultValue) || 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(defaultValue) || 0;
}
