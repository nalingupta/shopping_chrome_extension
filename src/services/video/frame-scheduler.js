// Handles drift-aware interval scheduling and gap accounting
export class FrameScheduler {
    constructor(intervalMs) {
        this._intervalMs = Math.max(10, Number(intervalMs) || 1000);
        this._basePerfMs = null;
        this._expectedTickIndex = 0;
        this._skipNextTick = false;
        this._timer = null;
    }

    start(loopFn) {
        const run = async () => {
            await loopFn();
        };
        this._timer = setInterval(run, this._intervalMs);
        // fire one immediate tick
        Promise.resolve(run()).catch(() => {});
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
    }

    computeGap(nowPerfMs) {
        if (this._basePerfMs == null) this._basePerfMs = nowPerfMs;
        const expectedIndex = Math.floor(
            (nowPerfMs - this._basePerfMs) / this._intervalMs
        );
        const gap = Math.max(0, expectedIndex - this._expectedTickIndex);
        return { gap, expectedIndex };
    }

    advanceExpected(count = 1) {
        this._expectedTickIndex += count;
    }

    requestSkipNext() {
        this._skipNextTick = true;
    }

    shouldSkipNext() {
        const s = this._skipNextTick;
        this._skipNextTick = false;
        return s;
    }
}
