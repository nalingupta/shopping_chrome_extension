# Shopping Assistant Chrome Extension

An AI-powered shopping assistant that helps users with product recommendations, price comparisons, and shopping insights.

## Features

-   🤖 AI-powered shopping assistance
-   🎤 Voice input support
-   💰 Price comparison and deal detection
-   🔍 Product recommendations
-   ⭐ Review analysis
-   📱 Clean, modern interface

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your toolbar

## Microphone Setup

The extension uses voice input for hands-free interaction. To enable microphone access:

### First Time Setup

1. Click the extension icon in your toolbar to open the side panel
2. Click the microphone button (🎤) in the chat interface
3. When prompted, click "Allow" to grant microphone permissions
4. The microphone button should turn red (🔴) when recording

### If Microphone Access is Denied

If you see a "Microphone access denied" error:

1. **Reload the Extension:**

    - Go to `chrome://extensions/`
    - Find "Shopping Assistant" and click the refresh button

2. **Check Site Permissions:**

    - Click the lock icon in your browser's address bar
    - Ensure microphone is set to "Allow"
    - Or go to `chrome://settings/content/microphone` and allow the extension

3. **Extension Permissions:**
    - Go to `chrome://extensions/`
    - Click "Details" on Shopping Assistant
    - Ensure "Audio capture" permission is enabled

### Troubleshooting

-   Make sure you're on a supported website (HTTPS)
-   Try refreshing the page and clicking the microphone button again
-   Check that your microphone is working in other applications
-   Restart Chrome if issues persist

## Configuration

### Voice Input Setup

To enable real voice transcription (instead of mock responses):

1. Get a free API key from [Cartesia](https://cartesia.ai)
2. Copy `config.example.js` to `config.js` (if not already done)
3. Replace `YOUR_CARTESIA_API_KEY_HERE` with your actual API key:
    ```javascript
    const CONFIG = {
        CARTESIA_API_KEY: "your_actual_api_key_here",
        CARTESIA_STT_MODEL: "ink-whisper-v1.0",
    };
    ```
4. Reload the extension in `chrome://extensions/`

**Note:** Without a valid API key, the voice input will show mock responses instead of transcribing your actual speech.

## Usage

1. Navigate to any shopping website (Amazon, eBay, etc.)
2. Click the extension icon to open the shopping assistant
3. Ask questions about products, prices, or get recommendations
4. Use voice input by clicking the microphone button
5. Try the suggested actions for quick help

## Development

### Project Structure

```
shopping_chrome_extension/
├── manifest.json          # Extension configuration
├── background.js          # Background service worker
├── content.js            # Content script for page analysis
├── sidepanel.html        # Main UI
├── sidepanel.js          # Side panel functionality
├── voiceInput.js         # Voice input handling
├── config.js             # API configuration
└── icons/                # Extension icons
```

### Testing

Run the test suite:

```bash
npm test
```

## Permissions

This extension requires the following permissions:

-   `activeTab`: To analyze the current page
-   `storage`: To save user preferences
-   `sidePanel`: To display the assistant interface
-   `audioCapture`: To access microphone for voice input
-   `tabCapture`: To capture tab audio for voice processing

## License

MIT License - see LICENSE file for details.
