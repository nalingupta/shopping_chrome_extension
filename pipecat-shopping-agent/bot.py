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
from pipecat.services.google import GoogleLLMService
from pipecat.transports.services.daily import DailyParams, DailyTransport

from loguru import logger

from dotenv import load_dotenv
load_dotenv()

logger.remove(0)
logger.add(sys.stderr, level="DEBUG")

# Simple Test Prompt - Just respond "yes" to verify connectivity
SHOPPING_ASSISTANT_PROMPT = """You are a simple test assistant. 

No matter what input you receive (audio, video, text, or any combination), always respond with exactly one word: "yes"

This is a connectivity test to verify that Pipecat and Gemini are working together properly."""

# Simplified approach - let Pipecat handle the multimodal processing automatically

async def bot():
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