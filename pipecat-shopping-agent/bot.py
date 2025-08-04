import asyncio
import os
import sys
import logging

from pipecat.frames.frames import LLMMessagesFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_response import LLMAssistantResponseAggregator
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.google.llm import GoogleLLMService
from pipecat.transports.services.daily import DailyParams, DailyTransport

from loguru import logger

from dotenv import load_dotenv
load_dotenv()

logger.remove(0)
logger.add(sys.stderr, level="DEBUG")

# Shopping Assistant Prompt for multimodal analysis
SHOPPING_ASSISTANT_PROMPT = """You are a helpful shopping assistant with access to both visual and audio input from the user.

You can see the user's screen (including web pages, shopping sites, product listings) and hear their questions through their microphone.

Your capabilities:
- Analyze product listings, prices, and reviews on any website
- Compare products across different sites
- Provide shopping recommendations based on what you see
- Answer questions about products visible on the screen
- Help with price comparisons and deal analysis
- Identify product features from images/videos

When the user asks questions or shows you products:
1. Look at what's currently displayed on their screen
2. Analyze any products, prices, or shopping content visible
3. Provide helpful, specific recommendations based on what you can see
4. If you can't see specific shopping content, ask them to navigate to the product or website they want help with

Be conversational, helpful, and specific in your responses. Reference what you can actually see on their screen."""

# Simplified approach - let Pipecat handle the multimodal processing automatically

async def bot(config=None):
    """Main bot function - entry point for Pipecat Cloud deployment"""
    
    # Get API keys from environment  
    daily_api_key = os.getenv("DAILY_API_KEY")
    google_api_key = os.getenv("GOOGLE_API_KEY")  # Gemini API key
    
    if not all([daily_api_key, google_api_key]):
        logger.error("Missing required API keys (Daily + Google)")
        return
    
    # Configure transport (Daily for WebRTC)
    transport = DailyTransport(
        room_url=os.getenv("DAILY_ROOM_URL"),
        token=os.getenv("DAILY_TOKEN"),
        bot_name="Shopping Assistant",
        params=DailyParams(
            audio_out_enabled=True,   # Enable audio output for responses
            audio_in_enabled=True,    # Receive audio for analysis
            video_in_enabled=True,    # Receive video for analysis
            vad_enabled=True          # Enable voice activity detection
        )
    )
    
    # Configure LLM (Gemini for multimodal capabilities)
    llm = GoogleLLMService(
        api_key=google_api_key,
        model="gemini-2.0-flash-exp",  # Latest Gemini model with vision
        system_prompt=SHOPPING_ASSISTANT_PROMPT
    )
    
    # Create assistant response aggregator
    assistant_response = LLMAssistantResponseAggregator()
    
    # Build the simplified pipeline - let Pipecat handle multimodal automatically
    pipeline = Pipeline([
        transport.input(),              # Daily WebRTC input (audio + video)
        llm,                           # Gemini LLM processing (handles multimodal automatically)
        transport.output(),            # Daily WebRTC output
        assistant_response             # Aggregate assistant responses
    ])
    
    # Create and run the task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True
        )
    )
    
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    logger.info("🛍️ Shopping Assistant starting up...")
    logger.info("🎯 Ready for direct multimodal Gemini processing!")
    
    # Run the pipeline
    runner = PipelineRunner()
    await runner.run(task)

if __name__ == "__main__":
    asyncio.run(bot())