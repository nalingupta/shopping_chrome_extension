#!/bin/bash

# Docker Registry Setup Script for Pipecat Shopping Assistant
# This script helps you set up Docker registry authentication and build/push images

set -e

echo "🐳 Docker Registry Setup for Pipecat Shopping Assistant"
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="shopping-assistant"
VERSION="0.4"

echo -e "${YELLOW}Step 1: Choose your registry${NC}"
echo "1) GitHub Container Registry (ghcr.io) - Recommended"
echo "2) Docker Hub (docker.io)"
echo "3) Local only (no push)"
read -p "Select option (1-3): " REGISTRY_CHOICE

case $REGISTRY_CHOICE in
    1)
        echo -e "${YELLOW}Setting up GitHub Container Registry...${NC}"
        read -p "Enter your GitHub username: " GITHUB_USERNAME
        
        if [ -z "$GITHUB_USERNAME" ]; then
            echo -e "${RED}Error: GitHub username is required${NC}"
            exit 1
        fi
        
        REGISTRY="ghcr.io"
        FULL_IMAGE_NAME="${REGISTRY}/${GITHUB_USERNAME}/${IMAGE_NAME}:${VERSION}"
        
        echo -e "${YELLOW}Step 2: GitHub Container Registry Authentication${NC}"
        echo "You need a GitHub Personal Access Token with 'write:packages' permission"
        echo "Create one at: https://github.com/settings/tokens"
        echo ""
        read -p "Enter your GitHub Personal Access Token: " -s GITHUB_TOKEN
        echo ""
        
        if [ -z "$GITHUB_TOKEN" ]; then
            echo -e "${RED}Error: GitHub token is required${NC}"
            exit 1
        fi
        
        echo "Logging into GitHub Container Registry..."
        echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully logged into GitHub Container Registry${NC}"
        else
            echo -e "${RED}❌ Failed to login to GitHub Container Registry${NC}"
            exit 1
        fi
        ;;
    2)
        echo -e "${YELLOW}Setting up Docker Hub...${NC}"
        read -p "Enter your Docker Hub username: " DOCKER_USERNAME
        
        if [ -z "$DOCKER_USERNAME" ]; then
            echo -e "${RED}Error: Docker Hub username is required${NC}"
            exit 1
        fi
        
        REGISTRY="docker.io"
        FULL_IMAGE_NAME="${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"
        
        echo -e "${YELLOW}Step 2: Docker Hub Authentication${NC}"
        read -p "Enter your Docker Hub password/token: " -s DOCKER_PASSWORD
        echo ""
        
        if [ -z "$DOCKER_PASSWORD" ]; then
            echo -e "${RED}Error: Docker Hub password is required${NC}"
            exit 1
        fi
        
        echo "Logging into Docker Hub..."
        echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully logged into Docker Hub${NC}"
        else
            echo -e "${RED}❌ Failed to login to Docker Hub${NC}"
            exit 1
        fi
        ;;
    3)
        echo -e "${YELLOW}Building locally only...${NC}"
        FULL_IMAGE_NAME="${IMAGE_NAME}:${VERSION}"
        ;;
    *)
        echo -e "${RED}Invalid option selected${NC}"
        exit 1
        ;;
esac

echo -e "${YELLOW}Step 3: Building Docker image...${NC}"
echo "Building: $FULL_IMAGE_NAME"

# Build the image with no cache to ensure clean build
docker build --no-cache -t "$FULL_IMAGE_NAME" .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
    echo "Image: $FULL_IMAGE_NAME"
    echo "Size: $(docker images $FULL_IMAGE_NAME --format "table {{.Size}}" | tail -n 1)"
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi

if [ "$REGISTRY_CHOICE" != "3" ]; then
    echo -e "${YELLOW}Step 4: Pushing to registry...${NC}"
    
    docker push "$FULL_IMAGE_NAME"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Image pushed successfully to registry${NC}"
        echo -e "${GREEN}📦 Your image is available at: $FULL_IMAGE_NAME${NC}"
        
        # Generate deployment command
        echo ""
        echo -e "${YELLOW}🚀 Deploy to Pipecat Cloud:${NC}"
        if [ "$REGISTRY_CHOICE" == "1" ]; then
            echo "pcc deploy shopping-assistant $FULL_IMAGE_NAME --secrets shopping-assistant-secrets --credentials github-registry-creds"
        else
            echo "pcc deploy shopping-assistant $FULL_IMAGE_NAME --secrets shopping-assistant-secrets --no-credentials"
        fi
    else
        echo -e "${RED}❌ Failed to push image to registry${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}🎉 Docker setup complete!${NC}"
echo "Image: $FULL_IMAGE_NAME"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Deploy to Pipecat Cloud using the command above"
echo "2. Test your Chrome extension"
echo "3. Update prompts using: python set_prompt.py prompts/enhanced_shopping_assistant.txt"