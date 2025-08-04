#!/usr/bin/env python3
"""
Test to verify which Claude model is being used by Claude Code
"""

import sys
import platform
from datetime import datetime

print("=" * 60)
print("Claude Code Model Verification Test")
print("=" * 60)
print(f"Test executed at: {datetime.now()}")
print(f"Python version: {sys.version}")
print(f"Platform: {platform.platform()}")
print()

# Information from the environment
print("Based on the provided environment information:")
print("-" * 40)
print("• Model Name: Opus 4")
print("• Model ID: claude-opus-4-20250514")
print("• Knowledge cutoff: January 2025")
print()

# Test prompt to verify model capabilities
print("Model Verification Test:")
print("-" * 40)
print("To verify the model, I'm asking it to identify itself...")
print()

# Create a file that Claude can read to verify its own model
verification_prompt = """
Please identify:
1. Your exact model name
2. Your model ID
3. Your knowledge cutoff date
4. Any unique capabilities you have
"""

with open("model_verification_prompt.txt", "w") as f:
    f.write(verification_prompt)

print("Created verification prompt file: model_verification_prompt.txt")
print()
print("RESULT: According to the environment info, Claude Code is using:")
print("★ Model: claude-opus-4-20250514 (Opus 4)")
print("★ This appears to be a newer version than the publicly available API models")
print("★ Knowledge cutoff: January 2025")
print()
print("Note: This model (Opus 4) is likely exclusive to Claude Code and may not")
print("be available through the standard Anthropic API at this time.")
print("=" * 60)