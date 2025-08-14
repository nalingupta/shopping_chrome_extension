#!/bin/bash

# Production deployment script for shopping extension server

set -e

echo "🚀 Deploying Shopping Extension Server (Production Grade)"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo "📚 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Check environment file
if [ ! -f ".env" ]; then
    echo "⚠️  Creating .env template..."
    cat > .env << EOF
# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=false
LOG_LEVEL=INFO

# VAD Settings
VAD_SAMPLE_RATE=16000
VAD_FRAME_MS=30
VAD_MIN_SPEECH_MS=300
VAD_END_SILENCE_MS=800
VAD_PRE_ROLL_MS=200
VAD_POST_ROLL_MS=300
VAD_AMPLITUDE_THRESHOLD=0.02

# Buffer Limits
MAX_FRAMES_BUFFER=5000
MAX_AUDIO_CHUNKS=5000

# API Keys (REQUIRED)
GEMINI_API_KEY=your_gemini_api_key_here
EOF
    echo "📝 Please update .env file with your API keys before starting the server"
fi

# Run tests
echo "🧪 Running production tests..."
python test_production.py

echo "✅ Deployment complete!"
echo ""
echo "To start the server:"
echo "  Development: python -m app.main"
echo "  Production:  python main_prod.py"
echo ""
echo "API Documentation will be available at:"
echo "  http://localhost:8000/docs"
echo "  http://localhost:8000/redoc"
