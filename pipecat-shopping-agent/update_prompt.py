#!/usr/bin/env python3
"""
Script to update the Shopping Assistant prompt without redeployment.
This updates the SHOPPING_ASSISTANT_PROMPT environment variable in Pipecat Cloud.
"""

import os
import sys
import subprocess
from pathlib import Path

def read_prompt_from_file(filepath):
    """Read prompt from a text file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except FileNotFoundError:
        print(f"❌ Error: Prompt file '{filepath}' not found")
        return None
    except Exception as e:
        print(f"❌ Error reading prompt file: {e}")
        return None

def update_pipecat_secret(prompt_text):
    """Update the SHOPPING_ASSISTANT_PROMPT in Pipecat Cloud secrets."""
    try:
        # Use pcc secrets set to update the environment variable
        cmd = [
            'pcc', 'secrets', 'set', 
            'shopping-assistant-secrets',
            'SHOPPING_ASSISTANT_PROMPT',
            prompt_text
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        if result.returncode == 0:
            print("✅ Successfully updated SHOPPING_ASSISTANT_PROMPT in Pipecat Cloud!")
            print("🔄 The next agent restart will use the new prompt.")
            return True
        else:
            print(f"❌ Failed to update secret: {result.stderr}")
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"❌ Error updating Pipecat secret: {e}")
        print(f"📝 stderr: {e.stderr}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def main():
    if len(sys.argv) != 2:
        print("Usage: python update_prompt.py <prompt_file.txt>")
        print("\nExample:")
        print("  python update_prompt.py prompts/shopping_assistant.txt")
        print("\nThis will update the bot's system prompt without requiring redeployment.")
        sys.exit(1)
    
    prompt_file = sys.argv[1]
    
    print(f"📝 Reading prompt from: {prompt_file}")
    prompt_text = read_prompt_from_file(prompt_file)
    
    if prompt_text is None:
        sys.exit(1)
    
    print(f"📏 Prompt length: {len(prompt_text)} characters")
    print("📋 Prompt preview:")
    print("-" * 50)
    print(prompt_text[:200] + "..." if len(prompt_text) > 200 else prompt_text)
    print("-" * 50)
    
    confirm = input("\n🤔 Update the Shopping Assistant prompt? (y/N): ")
    if confirm.lower() not in ['y', 'yes']:
        print("❌ Cancelled.")
        sys.exit(0)
    
    success = update_pipecat_secret(prompt_text)
    
    if success:
        print("\n🎉 Prompt updated successfully!")
        print("💡 Tip: The agent will use the new prompt on the next session start.")
    else:
        print("\n❌ Failed to update prompt.")
        sys.exit(1)

if __name__ == "__main__":
    main()