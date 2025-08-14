// Simple WS smoke test: connect, send init + text, expect acks.
import WebSocket from "ws";

const WS_URL = "ws://127.0.0.1:8787/ws";

function waitFor(ws, predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const to = setTimeout(
            () => reject(new Error("timeout waiting for condition")),
            timeoutMs
        );
        const handler = (data) => {
            try {
                const obj = JSON.parse(data.toString());
                if (predicate(obj)) {
                    clearTimeout(to);
                    ws.off("message", handler);
                    resolve(obj);
                }
            } catch {}
        };
        ws.on("message", handler);
    });
}

async function run() {
    const ws = new WebSocket(WS_URL);
    await new Promise((res, rej) => {
        ws.on("open", res);
        ws.on("error", rej);
    });
    // init
    ws.send(
        JSON.stringify({
            type: "init",
            sessionId: "smoke",
            fps: 1,
            sampleRate: 16000,
            seq: 1,
        })
    );
    await waitFor(ws, (m) => m.type === "ack" && m.ackType === "init");
    // send a text
    ws.send(
        JSON.stringify({
            type: "text",
            text: "Hello",
            tsMs: Date.now(),
            seq: 2,
        })
    );
    await waitFor(ws, (m) => m.type === "ack" && m.ackType === "text");
    // optional response
    await waitFor(
        ws,
        (m) => m.type === "response" && typeof m.text === "string",
        10000
    ).catch(() => {});
    ws.close();
    console.log("WS smoke OK");
}

run().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
