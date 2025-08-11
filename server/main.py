import asyncio
import json
import logging
import os
from typing import Any, Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware


logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")

app = FastAPI(title="Shopping Extension Backend", version="0.1.0")

# Allow local development from extension and localhost tools
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return JSONResponse(content={"status": "ok"}, status_code=200)


class ConnectionState:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.session_id: str | None = None
        self.frames_received: int = 0
        self.audio_chunks_received: int = 0
        self.transcripts_received: int = 0
        self.text_msgs_received: int = 0


async def _send_json_safe(ws: WebSocket, payload: Dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to send WS message: %s", exc)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state = ConnectionState(websocket)
    logger.info("WS connected: %s", websocket.client)

    # Periodic status pings
    async def status_task():
        try:
            while True:
                await asyncio.sleep(5)
                await _send_json_safe(
                    websocket,
                    {
                        "type": "status",
                        "state": "ready",
                        "frames": state.frames_received,
                        "audio": state.audio_chunks_received,
                        "transcripts": state.transcripts_received,
                        "text": state.text_msgs_received,
                    },
                )
        except Exception:
            # Task ends when connection closes
            return

    status_bg = asyncio.create_task(status_task())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json_safe(websocket, {"type": "error", "message": "invalid_json"})
                continue

            mtype = message.get("type")
            seq = message.get("seq")

            if mtype == "init":
                state.session_id = message.get("sessionId")
                logger.info(
                    "INIT session=%s fps=%s sr=%s", state.session_id, message.get("fps"), message.get("sampleRate")
                )
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "init"})
            elif mtype == "imageFrame":
                state.frames_received += 1
                if state.frames_received % 100 == 0:
                    logger.info("Frames received: %d", state.frames_received)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "imageFrame"})
            elif mtype == "audioChunk":
                state.audio_chunks_received += 1
                if state.audio_chunks_received % 100 == 0:
                    logger.info("Audio chunks received: %d", state.audio_chunks_received)
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "audioChunk"})
            elif mtype == "transcript":
                state.transcripts_received += 1
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "transcript"})
            elif mtype == "text":
                state.text_msgs_received += 1
                await _send_json_safe(websocket, {"type": "ack", "seq": seq, "ackType": "text"})
            else:
                await _send_json_safe(websocket, {"type": "error", "message": f"unknown_type:{mtype}"})

    except WebSocketDisconnect:
        logger.info("WS disconnected: %s", websocket.client)
    except Exception as exc:  # noqa: BLE001
        logger.exception("WS error: %s", exc)
    finally:
        status_bg.cancel()


