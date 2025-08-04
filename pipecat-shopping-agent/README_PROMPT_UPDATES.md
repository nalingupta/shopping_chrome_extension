# Shopping Assistant Prompt Management

This directory contains tools to update the Shopping Assistant's system prompt **without requiring redeployment**.

## How It Works

The bot now reads its system prompt from the `SHOPPING_ASSISTANT_PROMPT` environment variable. If not set, it uses a default prompt. This allows you to update the prompt dynamically via Pipecat Cloud secrets.

## Quick Start

### 1. Update with a Pre-made Prompt

```bash
# Use the basic shopping assistant prompt (interactive)
python update_prompt.py prompts/shopping_assistant.txt

# Use the enhanced shopping assistant prompt (non-interactive)
python set_prompt.py prompts/enhanced_shopping_assistant.txt
```

### 2. Create Your Own Prompt

1. Create a new `.txt` file in the `prompts/` directory
2. Write your custom prompt
3. Update the bot:

```bash
python update_prompt.py prompts/my_custom_prompt.txt
```

### 3. Verify the Update

After updating, the bot will log which prompt it's using:
- `🎯 Using custom system prompt from environment variable` = Your custom prompt is active
- `📝 Using default system prompt` = Using the fallback prompt

## Available Prompts

- **`shopping_assistant.txt`** - Basic shopping assistant prompt
- **`enhanced_shopping_assistant.txt`** - More detailed prompt with structured approach

## Benefits

✅ **No Redeployment Needed** - Update prompts instantly  
✅ **Version Control** - Keep different prompt versions in files  
✅ **Easy Testing** - Try different prompts quickly  
✅ **Rollback** - Easy to revert to previous prompts  

## Technical Details

- The bot checks for `SHOPPING_ASSISTANT_PROMPT` environment variable on startup
- Environment variables are managed via Pipecat Cloud secrets
- The `update_prompt.py` script uses `pcc secrets set` to update the value
- Changes take effect on the next agent session (no restart needed)

## Examples

### Testing a More Conversational Prompt
```bash
echo "You are a friendly shopping buddy who loves helping people find great deals! Always be enthusiastic and use emojis." > prompts/friendly.txt
python update_prompt.py prompts/friendly.txt
```

### Reverting to Default
Simply remove the environment variable:
```bash
pcc secrets unset shopping-assistant-secrets SHOPPING_ASSISTANT_PROMPT
```

## Tips

- Keep prompts focused and specific
- Test prompts with actual shopping websites
- Use the Chrome extension's debug mode to see how the bot responds
- Shorter prompts often work better for real-time conversation