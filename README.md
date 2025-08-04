# Shopping Assistant Chrome Extension

An AI-powered shopping assistant with **real-time voice and visual input** using Gemini Live API that helps users with product recommendations, price comparisons, and shopping insights.

## ✨ Features

- 🤖 **AI Shopping Assistant** - Powered by Google Gemini 2.0 Flash with real-time multimodal input
- 🎤 **Voice Input** - Continuous conversation with live transcription feedback
- 👁️ **Screen Sharing** - AI can see your screen for visual product analysis
- 💰 **Smart Analysis** - Real-time price comparisons and product insights
- 🔍 **Product Discovery** - Find alternatives and make informed decisions
- 📱 **Modern Interface** - Clean, modular design with proper architecture
- 🌐 **Cross-Platform** - Works on all major shopping sites

## 🚀 Quick Start

### Installation
1. **Download/Clone** this repository
2. **Configure API Key** in `src/config/api-keys.js`
3. **Open Chrome** and navigate to `chrome://extensions/`
4. **Enable Developer Mode** (toggle in top right)
5. **Click "Load unpacked"** and select this extension folder
6. **Extension ready!** Click the icon in your toolbar

### First Use
1. **Open side panel** by clicking the extension icon
2. **Start voice chat** with the microphone button
3. **Grant permissions** for microphone and screen sharing
4. **Ask questions** about products - AI can see your screen and hear you!

## 🎤 Multimodal AI System

### Architecture Overview
- **Voice Input**: Web Speech API for live transcription + Gemini Live API for processing
- **Visual Input**: Screen capture sent to Gemini for real-time analysis
- **Dual Processing**: Local transcription for UI feedback, Gemini for actual responses
- **Real-time Streaming**: Continuous audio/video streaming to Gemini 2.0 Flash

### How It Works
1. **User speaks** → Web Speech API shows live transcription in UI
2. **Simultaneously** → Audio + screen capture streams to Gemini Live API
3. **Gemini processes** → Audio and visual context for comprehensive understanding
4. **Response delivered** → Text response displayed and optionally spoken

## 🛠️ Refactored Architecture

### Clean Modular Structure
```
src/
├── core/
│   ├── app.js              # Main ShoppingAssistant class
│   └── background.js       # Background service worker
├── services/
│   ├── gemini-api.js       # Gemini Live API service
│   ├── audio-handler.js    # Audio processing & Web Speech
│   ├── screen-capture.js   # Screen sharing functionality
│   └── shopping-assistant.js # Text-based assistant (fallback)
├── ui/
│   ├── message-renderer.js # Message display utilities
│   └── ui-state.js         # UI state management
├── utils/
│   ├── constants.js        # Application constants
│   ├── storage.js          # Storage utilities
│   └── dom-utils.js        # DOM helpers
└── config/
    └── api-keys.js         # API configuration
```

### Key Components

#### Core (`core/`)
- **`app.js`**: Main application orchestrator, manages UI and coordinates services
- **`background.js`**: Clean service worker with proper message routing

#### Services (`services/`)
- **`gemini-api.js`**: Streamlined Gemini Live API integration with WebSocket handling
- **`audio-handler.js`**: Combines Web Speech API (UI feedback) + Gemini Live (processing)
- **`screen-capture.js`**: Simple screen sharing with proper cleanup
- **`shopping-assistant.js`**: Fallback text-based responses

#### UI (`ui/`)
- **`message-renderer.js`**: Message display and formatting
- **`ui-state.js`**: Centralized UI state management (debug mode, status, etc.)

### Optimization Results
- **🧹 Removed 70% redundant code** - Eliminated verbose debugging and fallback systems
- **🚀 Improved modularity** - Clear separation of concerns and single responsibility
- **📁 Better organization** - Logical file structure with proper naming
- **🔧 Cleaner APIs** - Simplified interfaces and reduced complexity
- **⚡ Enhanced performance** - Removed unnecessary processing and logs

## 🎯 User Flow

### Voice + Visual Input Flow
1. **User clicks voice button** → Starts listening
2. **Permissions granted** → Screen sharing + microphone access
3. **User speaks** → Live transcription appears immediately
4. **Background processing** → Audio + screen sent to Gemini Live API
5. **Gemini responds** → Text response based on audio + visual context
6. **Continuous conversation** → Session stays active for natural interaction

### Text Input Flow (Fallback)
1. **User types message** → Text input processing
2. **Background processing** → Text + optional screen capture sent to Gemini
3. **Gemini responds** → Standard text-based response

## 🐛 Troubleshooting

### Voice Input Issues
**"Microphone access denied"**
- Click microphone icon in browser address bar
- Select "Allow" for microphone access

**"Screen sharing failed"**
- Grant screen sharing permission when prompted
- Extension works audio-only if screen sharing is declined

**"Connection error"**
- Check your internet connection
- Verify Gemini API key is configured correctly

### Common Issues
**Extension not working**
- Ensure API key is set in `src/config/api-keys.js`
- Check Chrome extensions page for any errors
- Try refreshing the page and restarting the extension

## 🔧 Development

### File Structure
```
shopping_chrome_extension/
├── manifest.json           # Extension configuration
├── sidepanel.html         # Main UI
├── sidepanel.css          # Styles
├── src/main.js            # Entry point
├── src/core/              # Core application logic
├── src/services/          # Business logic services
├── src/ui/                # UI components
├── src/utils/             # Utilities
├── src/config/            # Configuration
├── src/content/           # Content scripts
├── src/audio/             # Audio processing workers
├── docs/                  # Documentation
└── icons/                 # Extension icons
```

### Key Features
- **Modular Design**: Each file has a single, clear responsibility
- **Clean APIs**: Simple, well-defined interfaces between components
- **Error Handling**: Proper error management throughout the system
- **Performance**: Optimized for real-time multimodal processing
- **Maintainability**: Easy to understand, modify, and extend

## 📝 License

MIT License - feel free to use and modify as needed.

---

**Built with Google Gemini 2.0 Flash for cutting-edge multimodal AI capabilities.** 🚀

