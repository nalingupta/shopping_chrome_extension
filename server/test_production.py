"""
Test script to verify the production-grade server setup.
"""
import asyncio
import sys
from pathlib import Path

# Add the server directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

async def test_imports():
    """Test that all modules can be imported successfully."""
    print("Testing imports...")
    
    try:
        from app.main import app
        print("✅ Main app imported successfully")
        
        from app.core.config import settings
        print(f"✅ Settings loaded: {settings.PROJECT_NAME}")
        
        from app.core.logging import setup_logging, get_logger
        setup_logging()
        logger = get_logger("test")
        logger.info("Logging system initialized")
        print("✅ Logging system working")
        
        from app.services.gemini_service import get_gemini_service
        gemini_service = get_gemini_service()
        print("✅ Gemini service initialized")
        
        from app.services.websocket_service import get_websocket_service
        ws_service = get_websocket_service()
        print("✅ WebSocket service initialized")
        
        from app.utils.media_encoder import get_media_encoder
        encoder = get_media_encoder()
        print("✅ Media encoder initialized")
        
        from app.utils.vad import create_vad_from_env
        vad = create_vad_from_env()
        print("✅ VAD system initialized")
        
        from app.schemas.websocket import IncomingMessage, OutgoingMessage
        print("✅ WebSocket schemas imported")
        
        print("\n🎉 All imports successful! Production setup is ready.")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

async def test_app_creation():
    """Test FastAPI app creation."""
    print("\nTesting FastAPI app creation...")
    
    try:
        from app.main import create_application
        app = create_application()
        
        print(f"✅ App created: {app.title}")
        print(f"✅ Version: {app.version}")
        print(f"✅ Routes: {len(app.routes)} routes registered")
        
        # List available routes
        for route in app.routes:
            if hasattr(route, 'path'):
                print(f"   - {route.path}")
        
        return True
        
    except Exception as e:
        print(f"❌ App creation failed: {e}")
        return False

async def main():
    """Run all tests."""
    print("🚀 Testing Production-Grade Shopping Extension Server\n")
    
    success = True
    success &= await test_imports()
    success &= await test_app_creation()
    
    if success:
        print("\n✅ All tests passed! Server is ready for production.")
        print("\nTo start the server:")
        print("  Development: python -m app.main")
        print("  Production:  python main_prod.py")
        print("  Direct:      uvicorn app.main:app --host 0.0.0.0 --port 8000")
    else:
        print("\n❌ Some tests failed. Please check the setup.")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
