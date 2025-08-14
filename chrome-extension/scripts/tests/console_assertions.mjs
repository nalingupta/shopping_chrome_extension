// Minimal CDP console assertions for extension logs
// Requires the side panel to be open in a running Chrome instance with --remote-debugging-port=9222
// Non-blocking: exits 0 if required patterns are found within timeout, else 1.

import fetch from "node-fetch";

const CDP_URL = "http://127.0.0.1:9222/json";
const TIMEOUT_MS = 8000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function findTarget() {
    const res = await fetch(CDP_URL);
    const tabs = await res.json();
    // Heuristic: pick any extension page for our side panel
    const target = tabs.find(
        (t) =>
            (t.type === "page" || t.type === "other") &&
            /chrome-extension:/.test(t.url)
    );
    return target;
}

async function run() {
    const target = await findTarget();
    if (!target) {
        console.error("No extension target found via CDP");
        process.exit(1);
    }
    const wsUrl = target.webSocketDebuggerUrl;
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
        ws.on("open", res);
        ws.on("error", rej);
    });
    let id = 0;
    const nextId = () => ++id;
    const send = (method, params = {}) =>
        ws.send(JSON.stringify({ id: nextId(), method, params }));
    let foundLifecycle = false;
    let foundTick = false;
    let foundTab = false;
    ws.on("message", (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.method === "Runtime.consoleAPICalled") {
                const texts = (msg.params.args || [])
                    .map((a) => a.value)
                    .filter(Boolean)
                    .join(" ");
                if (
                    /\[Lifecycle\] Extension reloaded -> cleared conversation/.test(
                        texts
                    )
                )
                    foundLifecycle = true;
                if (/Tick series: /.test(texts)) foundTick = true;
                if (/Tab .* \| Miss freq: /.test(texts)) foundTab = true;
            }
        } catch {}
    });
    send("Runtime.enable");
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
        if (foundLifecycle && foundTick && foundTab) {
            console.log("extension console assertions OK");
            ws.close();
            process.exit(0);
        }
        await sleep(250);
    }
    console.error("required console patterns not observed in time");
    ws.close();
    process.exit(1);
}

run().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
});
