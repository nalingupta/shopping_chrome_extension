"""
Production entry point for the shopping extension server.
"""
import uvicorn
from app.main import app
from app.core.config import settings

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        reload=False,  # Disable reload in production
        log_level=settings.LOG_LEVEL.lower(),
        access_log=True,
    )
