from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import os
import logging
import sys
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    # If python-dotenv is not installed, continue without raising
    pass

app = FastAPI(title="ADK Live Bridge", version="0.1.0")

# Configure ADK loggers and attach stream handlers so logs appear in terminal
_default_level_name = (os.getenv("ADK_LOG_LEVEL") or os.getenv("LOG_LEVEL") or "INFO").upper()
_default_level = getattr(logging, _default_level_name, logging.INFO)

class ChunkLogFilter(logging.Filter):
    def __init__(self) -> None:
        super().__init__()
        self.suppress = (os.getenv("SUPPRESS_CHUNK_DEBUG", "1") or "1").strip() not in ("0", "false", "False")
        # Substrings typical of noisy chunk DEBUG logs
        self._drop_terms = (
            "recv_json type=audio_chunk_header",
            "recv_json type=video_chunk_header",
            "audio_chunk_header",
            "video_chunk_header",
            "audio_chunk recv",
            "video_chunk recv",
            "forward_blob type=audio",
            "forward_blob type=video",
            "ingest_blob bytes=",
        )

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        if not self.suppress:
            return True
        try:
            if record.levelno >= logging.INFO:
                return True
            msg = str(record.getMessage())
            for t in self._drop_terms:
                if t in msg:
                    return False
            return True
        except Exception:
            return True

def _level_for(name_env: str, fallback: int) -> int:
    try:
        val = os.getenv(name_env)
        if not val:
            return fallback
        return getattr(logging, val.upper(), fallback)
    except Exception:
        return fallback

for _name in ("adk.ws", "adk.bridge"):
    _lg = logging.getLogger(_name)
    # Allow per-logger overrides
    _level = _level_for("ADK_WS_LEVEL" if _name == "adk.ws" else "ADK_BRIDGE_LEVEL", _default_level)
    _lg.setLevel(_level)
    if not _lg.handlers:
        _handler = logging.StreamHandler(stream=sys.stdout)
        _handler.setLevel(_level)
        _fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        _handler.setFormatter(_fmt)
        # Attach noise filter for DEBUG chunk spam
        _handler.addFilter(ChunkLogFilter())
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
    try:
        print("[WS] accepted /ws/live")
    except Exception:
        pass

    # Optional auth placeholder (Phase 5)
    # token = websocket.query_params.get("token")
    # from .auth import verify_jwt
    # if not verify_jwt(token):
    #     await websocket.close(code=4403)
    #     return

    try:
        try:
            # Yield to event loop once, then proceed
            import asyncio as _asyncio
            await _asyncio.sleep(0)
            print("[WS] post-accept entering bridge import")
        except Exception:
            pass
        try:
            from .stream_bridge import LiveStreamBridge
            try:
                print("[WS] bridge import OK")
            except Exception:
                pass
        except Exception as exc:
            try:
                import traceback as _tb
                print("[WS] bridge_import_failed:", str(exc))
                print(_tb.format_exc())
            except Exception:
                pass
            return
        try:
            bridge = LiveStreamBridge(websocket)
        except Exception as exc:
            try:
                print("[WS] bridge_construct_failed:", str(exc))
            except Exception:
                pass
            return
        try:
            print("[WS] bridge constructed")
        except Exception:
            pass
        try:
            print("[WS] bridge.run starting")
        except Exception:
            pass
        try:
            await bridge.run()
        except Exception as exc:
            try:
                print("[WS] bridge_run_failed:", str(exc))
            except Exception:
                pass
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


