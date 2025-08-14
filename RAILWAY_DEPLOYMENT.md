# Railway Deployment Guide

This guide covers deploying the production-grade shopping extension server to Railway.

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **Railway CLI** (optional): `npm install -g @railway/cli`
3. **Git Repository**: Your code should be in a Git repository

## Deployment Files Created

- `Dockerfile` - Multi-stage Docker build optimized for production
- `.dockerignore` - Excludes unnecessary files from Docker context
- `railway.json` - Railway-specific configuration
- Updated `server/app/core/config.py` - Railway PORT environment variable support

## Environment Variables

Set these environment variables in your Railway project:

### Required
```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

### Optional (with defaults)
```bash
# Logging
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

# Media Processing
CAPTURE_FPS=1.0
ENCODE_FPS=2.0
```

## Deployment Methods

### Method 1: GitHub Integration (Recommended)

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Add Railway deployment configuration"
   git push origin main
   ```

2. **Connect to Railway**:
   - Go to [railway.app](https://railway.app)
   - Click "Start a New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Railway will automatically detect the Dockerfile

3. **Set Environment Variables**:
   - In Railway dashboard, go to your project
   - Click on "Variables" tab
   - Add `GEMINI_API_KEY` and any other required variables

4. **Deploy**:
   - Railway will automatically build and deploy
   - Your app will be available at the generated Railway URL

### Method 2: Railway CLI

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and Initialize**:
   ```bash
   railway login
   railway init
   ```

3. **Set Environment Variables**:
   ```bash
   railway variables set GEMINI_API_KEY=your_api_key_here
   ```

4. **Deploy**:
   ```bash
   railway up
   ```

## Docker Build Features

- **Multi-stage build** for optimized image size
- **Python 3.11 slim** base image
- **FFmpeg** included for media processing
- **Non-root user** for security
- **Health checks** built-in
- **Proper caching** of dependencies

## Health Checks

The deployment includes health checks at:
- **Docker**: `http://localhost:$PORT/api/v1/health`
- **Railway**: Configured to use `/api/v1/health` endpoint

## API Endpoints

Once deployed, your API will be available at:
- **Root**: `https://your-app.railway.app/`
- **Health**: `https://your-app.railway.app/api/v1/health`
- **WebSocket**: `wss://your-app.railway.app/api/v1/ws`
- **Docs**: `https://your-app.railway.app/docs`
- **ReDoc**: `https://your-app.railway.app/redoc`

## Monitoring

Railway provides built-in monitoring:
- **Logs**: View application logs in real-time
- **Metrics**: CPU, memory, and network usage
- **Deployments**: Track deployment history
- **Health**: Automatic health check monitoring

## Troubleshooting

### Common Issues

1. **Build Failures**:
   - Check Dockerfile syntax
   - Ensure all dependencies are in requirements.txt
   - Verify Python version compatibility

2. **Runtime Errors**:
   - Check environment variables are set
   - Review application logs in Railway dashboard
   - Ensure GEMINI_API_KEY is valid

3. **Port Issues**:
   - Railway automatically sets PORT environment variable
   - Don't hardcode port numbers

### Logs

View logs in Railway dashboard or via CLI:
```bash
railway logs
```

## Scaling

Railway automatically handles:
- **Horizontal scaling** based on traffic
- **Resource allocation** (CPU/Memory)
- **Load balancing** for multiple instances

## Security

- **Non-root container** user
- **Environment variables** for secrets
- **HTTPS** enabled by default
- **CORS** configured for production

## Cost Optimization

- **Efficient Docker image** with minimal layers
- **Dependency caching** for faster builds
- **Resource limits** to control costs
- **Auto-sleep** for inactive applications (on free tier)

## Next Steps

1. Deploy to Railway using one of the methods above
2. Test all endpoints and WebSocket functionality
3. Configure custom domain (optional)
4. Set up monitoring and alerts
5. Configure CI/CD for automatic deployments

Your production-grade shopping extension server is now ready for Railway deployment! 🚀
