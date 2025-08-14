"""
Logging configuration for the shopping extension server.
"""
import logging
import os
import sys
from typing import Dict, Any


def setup_logging() -> None:
    """Configure logging for the application."""
    log_level_name = os.getenv("SERVER_LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    
    # Create formatter
    formatter = logging.Formatter(
        fmt="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Set specific logger levels
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance with the given name."""
    return logging.getLogger(name)


def log_request_info(logger: logging.Logger, event_type: str, data: Dict[str, Any]) -> None:
    """Log request information in a structured format."""
    logger.info(f"{event_type}: {data}")


def log_error(logger: logging.Logger, error: Exception, context: str = "") -> None:
    """Log error with context information."""
    if context:
        logger.error(f"{context}: {str(error)}", exc_info=True)
    else:
        logger.error(f"Error: {str(error)}", exc_info=True)
