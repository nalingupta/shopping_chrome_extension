from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os
import logging
import sys

app = FastAPI(title="ADK Live Bridge", version="0.1.0")

# Configure ADK loggers and attach stream handlers so logs appear in terminal
_level_name = (os.getenv("ADK_LOG_LEVEL") or os.getenv("LOG_LEVEL") or "INFO").upper()
_level = getattr(logging, _level_name, logging.INFO)
for _name in ("adk.ws", "adk.bridge"):
    _lg = logging.getLogger(_name)
    _lg.setLevel(_level)
    if not _lg.handlers:
        _handler = logging.StreamHandler(stream=sys.stdout)
        _handler.setLevel(_level)
        _fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        _handler.setFormatter(_fmt)
        _lg.addHandler(_handler)
    _lg.propagate = False

# Permissive CORS for local dev; restrict in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/version")
async def version():
    return {"version": app.version}


@app.websocket("/ws/live")
async def live_ws(websocket: WebSocket):
    await websocket.accept()

    # Optional auth placeholder (Phase 5)
    # token = websocket.query_params.get("token")
    # from .auth import verify_jwt
    # if not verify_jwt(token):
    #     await websocket.close(code=4403)
    #     return

    try:
        from .stream_bridge import LiveStreamBridge

        bridge = LiveStreamBridge(websocket)
        await bridge.run()
    except WebSocketDisconnect:
        # Client disconnected
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_json({
                "type": "error",
                "code": "internal_error",
                "message": str(exc),
            })
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


