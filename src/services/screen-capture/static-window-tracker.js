export class StaticWindowTracker {
    constructor() {
        this.windowIdToActiveTabId = new Map();
        this.lastFocusedWindowId = null;
        this.started = false;
        this._listeners = null;
    }

    async start() {
        if (this.started) return { success: true };
        try {
            await this.#primeState();
            this.#attachListeners();
            this.started = true;
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error?.message || "failed_to_start_window_tracker",
            };
        }
    }

    async stop() {
        try {
            this.#detachListeners();
            this.windowIdToActiveTabId.clear();
            this.lastFocusedWindowId = null;
            this.started = false;
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error?.message || "failed_to_stop_window_tracker",
            };
        }
    }

    getLastFocusedWindowId() {
        return this.lastFocusedWindowId;
    }

    getActiveTabId(windowId) {
        return this.windowIdToActiveTabId.get(windowId) ?? null;
    }

    // --- internals ---

    async #primeState() {
        try {
            const wins = await chrome.windows.getAll({
                populate: false,
                windowTypes: ["normal"],
            });
            if (Array.isArray(wins) && wins.length > 0) {
                const win = wins.find((w) => w.focused) || wins[0];
                this.lastFocusedWindowId = win.id;
                const tabs = await chrome.tabs.query({
                    active: true,
                    windowId: win.id,
                });
                if (Array.isArray(tabs) && tabs.length > 0) {
                    this.windowIdToActiveTabId.set(win.id, tabs[0].id);
                }
            } else {
                this.lastFocusedWindowId = null;
            }
        } catch (_) {
            this.lastFocusedWindowId = null;
        }
    }

    #attachListeners() {
        if (this._listeners) return;
        this._listeners = {
            onActivated: async (activeInfo) => {
                try {
                    if (!activeInfo || typeof activeInfo.tabId !== "number")
                        return;
                    // Resolve windowId from tab if missing or unreliable
                    let wId = activeInfo.windowId;
                    if (typeof wId !== "number") {
                        try {
                            const tab = await chrome.tabs.get(activeInfo.tabId);
                            wId = tab?.windowId;
                        } catch (_) {
                            wId = undefined;
                        }
                    }
                    if (typeof wId === "number") {
                        this.windowIdToActiveTabId.set(wId, activeInfo.tabId);
                    }
                } catch (_) {}
            },
            onFocusChanged: async (windowId) => {
                try {
                    // WINDOW_ID_NONE when Chrome lost focus (e.g., switched apps)
                    if (windowId === chrome.windows.WINDOW_ID_NONE) {
                        // Keep last known normal window id for continuity
                        return;
                    }
                    try {
                        const win = await chrome.windows.get(windowId, {
                            populate: false,
                        });
                        if (win && win.type === "normal") {
                            this.lastFocusedWindowId = windowId;
                            try {
                                const tabs = await chrome.tabs.query({
                                    active: true,
                                    windowId,
                                });
                                if (Array.isArray(tabs) && tabs.length > 0) {
                                    this.windowIdToActiveTabId.set(
                                        windowId,
                                        tabs[0].id
                                    );
                                }
                            } catch (_) {}
                        } else {
                            // Ignore focus to devtools/panel/etc.
                        }
                    } catch (_) {}
                } catch (_) {}
            },
            onRemoved: (tabId, removeInfo) => {
                try {
                    // Clean any mapping entries pointing to this tabId
                    for (const [
                        wId,
                        aId,
                    ] of this.windowIdToActiveTabId.entries()) {
                        if (aId === tabId)
                            this.windowIdToActiveTabId.delete(wId);
                    }
                    // If the removed tab belonged to the last focused window and was active,
                    // we opportunistically re-query to set the new active tab id.
                    if (removeInfo && typeof removeInfo.windowId === "number") {
                        const wId = removeInfo.windowId;
                        if (wId === this.lastFocusedWindowId) {
                            chrome.tabs
                                .query({ active: true, windowId: wId })
                                .then((tabs) => {
                                    if (
                                        Array.isArray(tabs) &&
                                        tabs.length > 0
                                    ) {
                                        this.windowIdToActiveTabId.set(
                                            wId,
                                            tabs[0].id
                                        );
                                    }
                                })
                                .catch(() => {});
                        }
                    }
                } catch (_) {}
            },
        };

        chrome.tabs.onActivated.addListener(this._listeners.onActivated);
        chrome.windows.onFocusChanged.addListener(
            this._listeners.onFocusChanged
        );
        chrome.tabs.onRemoved.addListener(this._listeners.onRemoved);
    }

    #detachListeners() {
        if (!this._listeners) return;
        try {
            chrome.tabs.onActivated.removeListener(this._listeners.onActivated);
        } catch (_) {}
        try {
            chrome.windows.onFocusChanged.removeListener(
                this._listeners.onFocusChanged
            );
        } catch (_) {}
        try {
            chrome.tabs.onRemoved.removeListener(this._listeners.onRemoved);
        } catch (_) {}
        this._listeners = null;
    }
}
