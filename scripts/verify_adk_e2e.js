// Minimal E2E verification for ADK WSS skeleton
// Usage: npm run verify:adk

import WebSocket from "ws";

const WS_URL = process.env.ADK_WS_URL || "ws://localhost:8080/ws/live";
const WAIT_AFTER_END_MS = Number(process.env.WAIT_AFTER_END_MS || 15000);
const TEST_TEXT = process.env.TEST_TEXT || "hello from verify script";
const PING_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS || 10000);

function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    console.log(`Connecting to ${WS_URL} ...`);
    const ws = new WebSocket(WS_URL);

    ws.on("error", (err) => {
        console.error("WS error:", err.message || err);
        process.exitCode = 1;
    });

    let pingTimer = null;

    ws.on("close", (code, reason) => {
        console.log("WS closed:", code, reason?.toString());
        if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
        }
    });

    let gotDelta = false;
    let gotTurnComplete = false;

    ws.on("message", (data, isBinary) => {
        try {
            if (!isBinary) {
                const text =
                    typeof data === "string"
                        ? data
                        : Buffer.isBuffer(data)
                        ? data.toString("utf8")
                        : String(data);
                const msg = JSON.parse(text);
                if (msg.type === "text_delta") {
                    gotDelta = true;
                    console.log("delta:", msg.text);
                } else if (msg.type === "turn_complete") {
                    gotTurnComplete = true;
                    console.log("turn_complete");
                } else if (msg.type === "error") {
                    console.error("server error:", msg);
                } else if (msg.ok) {
                    console.log("ok");
                } else {
                    console.log("msg:", msg);
                }
                return;
            }
        } catch (e) {
            console.log("text (raw):", data);
            return;
        }
        const size = Buffer.isBuffer(data)
            ? data.byteLength
            : data?.byteLength || 0;
        console.log("binary frame", size);
    });

    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    console.log("Connected. Sending test messages...");
    // Heartbeat to keep the connection open during waits
    pingTimer = setInterval(() => {
        try {
            ws.send(JSON.stringify({ type: "ping" }));
        } catch {}
    }, PING_INTERVAL_MS);
    ws.send(
        JSON.stringify({
            type: "session_start",
            model: "gemini-1.5-pro",
            config: { response_modalities: ["TEXT"] },
        })
    );
    ws.send(JSON.stringify({ type: "activity_start" }));
    ws.send(
        JSON.stringify({
            type: "text_input",
            text: TEST_TEXT,
            ts: Date.now(),
        })
    );
    ws.send(JSON.stringify({ type: "activity_end" }));

    // Allow time for deltas or fallback
    console.log(`Waiting up to ${WAIT_AFTER_END_MS}ms for deltas...`);
    await wait(WAIT_AFTER_END_MS);

    try {
        ws.send(JSON.stringify({ type: "session_end" }));
    } catch {}
    await wait(200);
    try {
        ws.close();
    } catch {}

    if (gotDelta || gotTurnComplete) {
        console.log("VERIFY RESULT: PASS (received response)");
        process.exitCode = 0;
    } else {
        console.error("VERIFY RESULT: FAIL (no response within wait window)");
        process.exitCode = 2;
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
