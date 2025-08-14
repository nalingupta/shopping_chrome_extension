// FrontendVad: Lightweight frontend VAD for orchestration/UI only
// - Uses EMA-smoothed maxAmplitude with hysteresis and debounce
// - Emits onStart() and onEnd({ segmentStartMs, segmentEndMs })
// - Does not gate or alter audio transport

// Debug logging removed after verification

export class FrontendVad {
    /**
     * @param {Object} [config]
     * @param {number} [config.startThreshold] EMA level to trigger speech start (0..1)
     * @param {number} [config.endThreshold] EMA level below which silence accumulates (0..1)
     * @param {number} [config.minSpeechMs] Required sustained speech before emitting start
     * @param {number} [config.endSilenceMs] Required sustained silence before emitting end
     * @param {number} [config.emaAlpha] EMA smoothing factor (0..1]
     * @param {number} [config.preRollMs] Time subtracted from first frame to estimate onset
     * @param {number} [config.postRollMs] Time added after last speech frame when ending
     */
    constructor(config = {}) {
        const cfg = {
            startThreshold: 0.05,
            endThreshold: 0.03,
            minSpeechMs: 250,
            endSilenceMs: 600,
            emaAlpha: 0.2,
            preRollMs: 200,
            postRollMs: 200,
            ...config,
        };

        this.cfg = cfg;

        this.state = "idle"; // idle | speaking
        this.emaLevel = null;
        this.accSpeechMs = 0;
        this.accSilenceMs = 0;
        this.firstSpeechTsMs = null; // estimated start of segment
        this.lastSpeechFrameStartMs = null;

        this.callbacks = {
            onStart: null,
            onEnd: null,
        };
        // Debug toggle removed
    }

    /**
     * @param {{ onStart?: Function, onEnd?: Function }} callbacks
     */
    setCallbacks(callbacks = {}) {
        if (callbacks && typeof callbacks === "object") {
            this.callbacks.onStart =
                typeof callbacks.onStart === "function"
                    ? callbacks.onStart
                    : null;
            this.callbacks.onEnd =
                typeof callbacks.onEnd === "function" ? callbacks.onEnd : null;
        }
    }

    /**
     * Update VAD with a new audio block's amplitude level.
     * @param {number} level Max amplitude for the block (0..1)
     * @param {number} blockMs Duration of the block in milliseconds
     * @param {number|null} [tsStartMs] Session-relative timestamp for the start of this block
     */
    update(level, blockMs, tsStartMs = null) {
        const lvl = this.#clamp01(level);
        const dur = typeof blockMs === "number" && blockMs > 0 ? blockMs : 0;
        const ts =
            typeof tsStartMs === "number" && tsStartMs >= 0 ? tsStartMs : null;

        // Initialize EMA on first sample
        if (this.emaLevel === null) {
            this.emaLevel = lvl;
        } else {
            const a = this.#clamp(this.cfg.emaAlpha, 0.01, 1);
            this.emaLevel = a * lvl + (1 - a) * this.emaLevel;
        }

        if (this.state === "idle") {
            if (this.emaLevel >= this.cfg.startThreshold) {
                this.accSpeechMs += dur;
            } else {
                this.accSpeechMs = 0;
            }

            if (this.accSpeechMs >= this.cfg.minSpeechMs) {
                // Estimate first speech timestamp using accumulated speech
                const estimateBase = ts !== null ? ts : 0;
                const estStart = Math.max(
                    0,
                    estimateBase - (this.accSpeechMs - dur) - this.cfg.preRollMs
                );
                this.firstSpeechTsMs = estStart;
                this.lastSpeechFrameStartMs = ts;
                this.state = "speaking";
                this.accSilenceMs = 0;

                if (this.callbacks.onStart) {
                    try {
                        this.callbacks.onStart();
                    } catch (_) {}
                }
            }
            return;
        }

        // speaking state
        if (this.emaLevel < this.cfg.endThreshold) {
            this.accSilenceMs += dur;
        } else {
            this.accSilenceMs = 0;
        }

        // Track last speech frame start time for better end estimation
        if (this.emaLevel >= this.cfg.endThreshold) {
            this.lastSpeechFrameStartMs = ts;
        }

        if (this.accSilenceMs >= this.cfg.endSilenceMs) {
            const segStart = this.firstSpeechTsMs;
            const lastStart = this.lastSpeechFrameStartMs;
            const segEnd =
                lastStart !== null
                    ? lastStart + this.cfg.postRollMs
                    : ts !== null
                    ? ts + this.cfg.postRollMs
                    : null;

            // Reset state before invoking callbacks to avoid reentrancy issues
            this.#resetState();

            if (this.callbacks.onEnd) {
                try {
                    this.callbacks.onEnd({
                        segmentStartMs: segStart ?? null,
                        segmentEndMs: segEnd ?? null,
                    });
                } catch (_) {}
            }
        }
    }

    reset() {
        this.#resetState();
        this.emaLevel = null;
    }

    // Internal helpers
    #resetState() {
        this.state = "idle";
        this.accSpeechMs = 0;
        this.accSilenceMs = 0;
        this.firstSpeechTsMs = null;
        this.lastSpeechFrameStartMs = null;
    }

    #clamp01(x) {
        return this.#clamp(typeof x === "number" ? x : 0, 0, 1);
    }

    #clamp(x, min, max) {
        if (x < min) return min;
        if (x > max) return max;
        return x;
    }
}
