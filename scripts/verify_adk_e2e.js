// Minimal E2E verification for ADK WSS skeleton
// Usage: npm run verify:adk

import WebSocket from "ws";

const WS_URL = process.env.ADK_WS_URL || "ws://localhost:8080/ws/live";

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

    ws.on("close", (code, reason) => {
        console.log("WS closed:", code, reason?.toString());
    });

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
                    console.log("delta:", msg.text);
                } else if (msg.type === "turn_complete") {
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
            text: "hello from verify script",
            ts: Date.now(),
        })
    );
    ws.send(JSON.stringify({ type: "activity_end" }));

    // Give server some time to respond
    await wait(1000);
    ws.send(JSON.stringify({ type: "session_end" }));
    await wait(300);
    ws.close();
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
