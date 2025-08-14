"""
Main FastAPI application for the shopping extension server.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.router import api_router
from .core.config import settings
from .core.logging import setup_logging, get_logger

# Setup logging first
setup_logging()
logger = get_logger(__name__)


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description="Production-grade server for shopping Chrome extension with AI assistance",
        docs_url="/docs",
        redoc_url="/redoc",
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=settings.ALLOWED_METHODS,
        allow_headers=settings.ALLOWED_HEADERS,
    )
    
    # Include routers
    app.include_router(api_router, prefix=settings.API_V1_STR)
    
    # Add root health check
    @app.get("/")
    async def root():
        """Root endpoint with basic info."""
        return {
            "service": settings.PROJECT_NAME,
            "version": settings.VERSION,
            "status": "running",
            "docs": "/docs"
        }
    
    # Legacy health check endpoint (for backward compatibility)
    @app.get("/healthz")
    async def healthz():
        """Legacy health check endpoint."""
        return {"status": "ok"}
    
    logger.info(f"Application created: {settings.PROJECT_NAME} v{settings.VERSION}")
    return app


# Create the application instance
app = create_application()


if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
    )
