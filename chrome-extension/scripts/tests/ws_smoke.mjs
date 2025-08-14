// Simple WS smoke test: connect, send init + text + tiny imageFrame, expect acks.
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
    // expect a config message with captureFps
    await waitFor(
        ws,
        (m) => m.type === "config" && typeof m.captureFps === "number"
    );
    // send a tiny white 1x1 JPEG as an imageFrame
    const tinyJpegBase64 =
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEA8QDw8PEA8QDw8QDw8PDw8PDw8PFREWFhURFRUYHSggGBolHRUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGi0lICUtLS0tLSstLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAH4BgwMBIgACEQEDEQH/xAAcAAABBQEBAQAAAAAAAAAAAAAFAQIDBAYHAQj/xABCEAACAQIEAwUFBgUEAwEAAAABAgADEQQSITEFQVEGEyJhcYGRMqGxBzNCUrHB0RQjYqLxFUOSorPS8CMWNENTg7PD/8QAGQEAAwEBAQAAAAAAAAAAAAAAAAECAwQF/8QAKhEAAgICAgEDAwQDAAAAAAAAAAECEQMhEjEEQRMiUWEUMnGBkaHB8P/aAAwDAQACEQMRAD8A9xREQEREBERAREQEREBERAREQEREBERAREQEREBERAT//Z";
    ws.send(
        JSON.stringify({
            type: "imageFrame",
            base64: tinyJpegBase64,
            tsMs: Date.now(),
            seq: 3,
        })
    );
    await waitFor(ws, (m) => m.type === "ack" && m.ackType === "imageFrame");
    // send a text
    ws.send(
        JSON.stringify({
            type: "text",
            text: "Hello",
            tsMs: Date.now(),
            seq: 4,
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
