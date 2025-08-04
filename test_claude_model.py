import anthropic
import os
import json
from datetime import datetime

# Initialize the Anthropic client
client = anthropic.Anthropic(
    api_key=os.environ.get("ANTHROPIC_API_KEY")
)

print("Testing Claude API to verify model...")
print(f"Test time: {datetime.now()}")
print("-" * 50)

# Make a test request
try:
    message = client.messages.create(
        model="claude-3-opus-20240229",  # Try with Opus 3
        max_tokens=100,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": "What model are you? Please respond with just your model name and version."
            }
        ]
    )
    
    print("Response from API:")
    print(f"Model used: {message.model}")
    print(f"Response: {message.content[0].text}")
    print(f"Usage: {message.usage}")
    
except Exception as e:
    print(f"Error: {e}")
    print("\nTrying with different model...")
    
    # Try with a different model
    try:
        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",  # Try with Sonnet 3.5
            max_tokens=100,
            temperature=0,
            messages=[
                {
                    "role": "user",
                    "content": "What model are you? Please respond with just your model name and version."
                }
            ]
        )
        
        print("\nResponse from API (second attempt):")
        print(f"Model used: {message.model}")
        print(f"Response: {message.content[0].text}")
        print(f"Usage: {message.usage}")
        
    except Exception as e2:
        print(f"Second error: {e2}")

print("\n" + "-" * 50)
print("Note: Based on the environment info provided, Claude Code is using 'claude-opus-4-20250514'")
print("This is likely a newer model version (Opus 4) that may not be available via the standard API yet.")