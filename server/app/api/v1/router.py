"""
API v1 router for the shopping extension server.
"""
from fastapi import APIRouter, WebSocket
from fastapi.responses import JSONResponse

from ...core.logging import get_logger
from ...services.websocket_service import get_websocket_service

logger = get_logger(__name__)
api_router = APIRouter()
websocket_service = get_websocket_service()


@api_router.get("/health")
async def health_check():
    """Health check endpoint."""
    logger.debug("Health check requested")
    return JSONResponse(
        content={"status": "ok", "service": "shopping-extension-server"},
        status_code=200
    )


@api_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time communication."""
    await websocket_service.handle_connection(websocket)
