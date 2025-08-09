from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os

app = FastAPI(title="ADK Live Bridge", version="0.1.0")

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


