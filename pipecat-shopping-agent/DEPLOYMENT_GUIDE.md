# Shopping Assistant Agent - Pipecat Cloud Deployment Guide

## Prerequisites Setup

You only need **ONE** additional service:

### 1. Docker Hub Account (FREE)
- Go to: https://hub.docker.com/
- Create a free account  
- Remember your username - you'll need it for deployment

**That's it!** You already have:
- ✅ Daily API key (configured)
- ✅ Google/Gemini API key (configured)

## One-Time Setup (3 minutes)

### 1. Install Required Tools
```bash
# Install Docker Desktop
# Download from: https://www.docker.com/products/docker-desktop

# Install Pipecat Cloud CLI
pip install pipecatcloud

# Verify installations
docker --version
pcc --version
```

### 2. Set Up Docker Hub
```bash
# Login to Docker Hub (use your Docker Hub credentials)
docker login
```

### 3. Authenticate with Pipecat Cloud
```bash
# This will open a browser for authentication
pcc auth login
```

## Configuration (30 seconds)

**No API key configuration needed!** Everything is already set up.

Just replace `YOUR_DOCKER_USERNAME` in the commands below with your actual Docker Hub username.

## Deployment Commands (3 minutes)

Run these commands in this directory (`pipecat-shopping-agent/`):

```bash
# 1. Create secrets in Pipecat Cloud
pcc secrets set shopping-assistant-secrets --file .env

# 2. Build and push Docker image (replace YOUR_DOCKER_USERNAME)
docker build --platform=linux/arm64 -t shopping-assistant:latest .
docker tag shopping-assistant:latest YOUR_DOCKER_USERNAME/shopping-assistant:0.1
docker push YOUR_DOCKER_USERNAME/shopping-assistant:0.1

# 3. Deploy to Pipecat Cloud (replace YOUR_DOCKER_USERNAME)
pcc deploy shopping-assistant YOUR_DOCKER_USERNAME/shopping-assistant:0.1 --secrets shopping-assistant-secrets

# 4. Check deployment status
pcc agent status shopping-assistant
```

## Test Your Deployment

```bash
# Start an agent session
pcc agent start shopping-assistant --use-daily

# Check logs
pcc agent logs shopping-assistant

# Check status
pcc agent status shopping-assistant
```

## Getting Your Agent URL

After successful deployment, you'll get an agent URL that looks like:
`https://api.pipecat.daily.co/v1/shopping-assistant`

**Update the Chrome extension** with this deployed agent URL by replacing the `PIPECAT_AGENT_NAME` in `src/config/api-keys.js`.

## Troubleshooting

### Common Issues:

**"Docker daemon not running"**
- Start Docker Desktop application

**"Permission denied (docker push)"**
- Run `docker login` and enter your Docker Hub credentials

**"Agent deployment failed"**
- Check that all API keys are valid in your `.env` file
- Verify your Docker image was pushed successfully: `docker images`

**"No response from agent"**
- Check agent logs: `pcc agent logs shopping-assistant`
- Ensure all API keys have sufficient credits/quota

## Cost Estimates (Very Affordable!)

- **Daily**: Already covered by your existing key ✅
- **Google Gemini**: Already covered by your existing key ✅
- **Pipecat Cloud**: Usage-based pricing, typically $0.01-0.05 per minute of agent time
- **Docker Hub**: Free for public repositories ✅

**Total estimated cost for moderate usage: $3-10/month** (just Pipecat Cloud hosting)

## Next Steps

1. Complete the deployment following the commands above
2. Test the agent with `pcc agent start shopping-assistant --use-daily`
3. Update the Chrome extension configuration
4. Test the complete workflow: Chrome extension → Deployed agent → Real-time responses

The shopping assistant is now deployed and ready for real-time multimodal AI shopping assistance! 🛍️✨