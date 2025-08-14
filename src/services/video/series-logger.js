export class SeriesLogger {
    constructor() {
        this._tickSeries = [];
        this._tickRunType = null;
        this._tickRunCount = 0;
        this._tickTotal = 0;
        this._tickMisses = 0;
        this._segments = [];
        this._currentSegment = null;
    }

    note(kind) {
        this._tickTotal += 1;
        if (kind === "miss") this._tickMisses += 1;
        if (this._tickRunType === kind) this._tickRunCount += 1;
        else {
            if (this._tickRunType !== null) {
                this._tickSeries.push({
                    type: this._tickRunType,
                    count: this._tickRunCount,
                });
            }
            this._tickRunType = kind;
            this._tickRunCount = 1;
        }
    }

    async ensureSegment(tabId, urlFetcher) {
        const id = tabId ?? "unknown";
        if (!this._currentSegment || this._currentSegment.tabId !== id) {
            this._finalizeCurrentSegment();
            this._currentSegment = {
                tabId: id,
                series: [],
                runType: null,
                runCount: 0,
                total: 0,
                hits: 0,
                misses: 0,
            };
            this._segments.push(this._currentSegment);
            try {
                if (typeof id === "number") {
                    const tab = await urlFetcher(id);
                    if (tab?.url) {
                        this._currentSegment.url = tab.url;
                    }
                }
            } catch (_) {}
        }
    }

    noteSegment(kind) {
        if (!this._currentSegment) return;
        const d = this._currentSegment;
        d.total += 1;
        if (kind === "hit") d.hits += 1;
        else if (kind === "miss") d.misses += 1;
        if (d.runType === kind) d.runCount += 1;
        else {
            if (d.runType !== null)
                d.series.push({ type: d.runType, count: d.runCount });
            d.runType = kind;
            d.runCount = 1;
        }
    }

    emitAndReset(captureFps, durationMs) {
        if (this._tickRunType !== null && this._tickRunCount > 0) {
            this._tickSeries.push({
                type: this._tickRunType,
                count: this._tickRunCount,
            });
        }
        if (this._tickSeries.length > 0) {
            this._logSeriesLine(
                "Tick series",
                this._tickSeries,
                this._tickMisses,
                this._tickTotal,
                undefined,
                captureFps,
                durationMs
            );
        }
        this._finalizeCurrentSegment();
        for (const seg of this._segments) {
            const parts = [...seg.series];
            if (parts.length > 0) {
                this._logSeriesLine(
                    `Tab ${seg.tabId}`,
                    parts,
                    seg.misses || 0,
                    seg.total || 0,
                    seg.url || "unknown",
                    undefined
                );
            }
        }
        this._tickSeries = [];
        this._tickRunType = null;
        this._tickRunCount = 0;
        this._tickTotal = 0;
        this._tickMisses = 0;
        this._segments = [];
        this._currentSegment = null;
    }

    _finalizeCurrentSegment() {
        if (!this._currentSegment) return;
        const d = this._currentSegment;
        if (d.runType !== null && d.runCount > 0)
            d.series.push({ type: d.runType, count: d.runCount });
    }

    _logSeriesLine(prefix, series, misses, total, url, fps, durationMs) {
        let fmt = `${prefix}: `;
        const styles = [];
        series.forEach((run, idx) => {
            let token = "";
            let color = "color:#ef4444";
            if (run.type === "hit") {
                token = `+${run.count}`;
                color = "color:#16a34a";
            } else if (run.type === "miss") {
                token = `-${run.count}`;
            } else if (run.type === "substitute") {
                token = `-${run.count} (substituted)`;
            } else {
                token = `?${run.count}`;
            }
            fmt += `%c${token}`;
            styles.push(color);
            if (idx < series.length - 1) fmt += ", ";
        });
        const pct = total > 0 ? Math.round((misses / total) * 100) : 0;
        fmt += ` | Miss freq: ${misses}/${total} (${pct}%)`;
        if (url) fmt += ` (url: ${url})`;
        if (typeof fps === "number") fmt += ` (captureFps: ${fps})`;
        if (typeof durationMs === "number") {
            const secs = Math.round(durationMs / 1000);
            fmt += ` (duration: ${secs}s)`;
        }
        try {
            console.log(fmt, ...styles);
        } catch (_) {}
    }
}
