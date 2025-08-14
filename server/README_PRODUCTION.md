# Shopping Extension Server - Production Grade

A production-ready FastAPI server for the shopping Chrome extension with AI assistance capabilities.

## Architecture Overview

The server has been refactored from POC code into a modular, production-grade application with the following structure:

```
server/
├── app/
│   ├── api/v1/           # API routes and endpoints
│   ├── core/             # Core configuration and logging
│   ├── services/         # Business logic services
│   ├── utils/            # Utility modules
│   ├── schemas/          # Pydantic models for validation
│   └── main.py           # FastAPI application factory
├── main_prod.py          # Production entry point
├── requirements.txt      # Dependencies
└── .env                  # Environment configuration
```

## Key Features

- **Modular Architecture**: Clean separation of concerns with dedicated packages
- **Comprehensive Logging**: Structured logging with configurable levels
- **Type Safety**: Full type hints and Pydantic validation
- **Error Handling**: Robust error handling with fallback mechanisms
- **Configuration Management**: Environment-based configuration
- **WebSocket Support**: Real-time communication for audio/video processing
- **AI Integration**: Gemini AI service for multimodal responses

## Services

### 1. WebSocket Service (`app/services/websocket_service.py`)
- Handles real-time client connections
- Manages audio/video frame buffers
- Implements Voice Activity Detection (VAD)
- Processes speech segments and generates AI responses

### 2. Gemini Service (`app/services/gemini_service.py`)
- Integrates with Google's Gemini AI model
- Supports video, audio, and text processing
- Implements fallback mechanisms for reliability
- Handles API key management and client initialization

### 3. Media Encoder (`app/utils/media_encoder.py`)
- Encodes video frames and audio segments
- Uses FFmpeg for media processing
- Supports WebM output format
- Handles frame selection and audio synchronization

### 4. VAD Processor (`app/utils/vad.py`)
- Real-time Voice Activity Detection
- RMS-based speech detection
- Configurable thresholds and timing
- Speech segment boundary detection

## Configuration

All configuration is managed through environment variables and the `Settings` class:

```python
# Server settings
HOST=0.0.0.0
PORT=8000
DEBUG=false
LOG_LEVEL=INFO

# VAD settings
VAD_SAMPLE_RATE=16000
VAD_FRAME_MS=30
VAD_MIN_SPEECH_MS=300
VAD_END_SILENCE_MS=800
VAD_AMPLITUDE_THRESHOLD=0.02

# Buffer limits
MAX_FRAMES_BUFFER=5000
MAX_AUDIO_CHUNKS=5000

# API keys
GEMINI_API_KEY=your_api_key_here
```

## Running the Server

### Development Mode
```bash
cd server
pip install -r requirements.txt
python -m app.main
```

### Production Mode
```bash
cd server
python main_prod.py
```

### Using Uvicorn Directly
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /` - Root endpoint with service info
- `GET /api/v1/health` - Health check endpoint
- `GET /healthz` - Legacy health check (backward compatibility)
- `WS /api/v1/ws` - WebSocket endpoint for real-time communication
- `GET /docs` - Interactive API documentation
- `GET /redoc` - Alternative API documentation

## WebSocket Protocol

The WebSocket endpoint supports the following message types:

### Incoming Messages
- `session_start` - Initialize session
- `frame` - Video frame data (base64 encoded JPEG)
- `audio` - Audio chunk data (base64 encoded PCM)
- `transcript` - Speech transcript
- `text` - Text-only message

### Outgoing Messages
- `status` - Periodic status updates
- `transcript` - Processed transcript
- `segment` - Completed speech segment with AI response
- `response` - AI-generated response
- `error` - Error notifications

## Logging

The application uses structured logging with the following levels:
- `DEBUG` - Detailed debugging information
- `INFO` - General operational messages
- `WARNING` - Warning conditions
- `ERROR` - Error conditions with stack traces

Logs include timestamps, logger names, and contextual information for debugging.

## Error Handling

- Graceful degradation for AI service failures
- Fallback responses when media processing fails
- Comprehensive exception logging
- Client-friendly error messages

## Security Considerations

- CORS middleware configured for development (restrict in production)
- Environment-based configuration management
- No hardcoded API keys or sensitive data
- Input validation using Pydantic schemas

## Performance Features

- Configurable buffer limits to prevent memory issues
- Backpressure handling for high-throughput scenarios
- Efficient frame selection algorithms
- Optimized media encoding pipelines

## Dependencies

- **FastAPI**: Modern web framework with automatic API documentation
- **Uvicorn**: ASGI server for production deployment
- **Pydantic**: Data validation and settings management
- **Google GenAI**: Gemini AI model integration
- **python-dotenv**: Environment variable management

## Migration from POC

The original POC files have been refactored as follows:

- `main.py` → `app/services/websocket_service.py` + `app/main.py`
- `gemini_client.py` → `app/services/gemini_service.py`
- `media_encoder.py` → `app/utils/media_encoder.py`
- `vad.py` → `app/utils/vad.py`

All functionality has been preserved while adding:
- Better error handling and logging
- Type safety and validation
- Modular architecture
- Configuration management
- Production-ready deployment options
