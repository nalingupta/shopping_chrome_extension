# Shopping Assistant Chrome Extension

An AI-powered shopping assistant with **real-time voice input** that helps users with product recommendations, price comparisons, and shopping insights.

## ✨ Features

- 🤖 **Smart Shopping Assistant** - Context-aware product help and recommendations
- 🎤 **Real-time Voice Input** - Browser-native speech recognition with auto-restart
- 💰 **Price Analysis** - Deal detection and price comparison guidance  
- 🔍 **Product Discovery** - Find similar products and alternatives
- ⭐ **Review Analysis** - Help interpreting ratings and reviews
- 📱 **Modern Interface** - Clean, responsive side panel design
- 🌐 **Cross-Domain Support** - Works on all major shopping sites

## 🚀 Quick Start

### Installation
1. **Download/Clone** this repository
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** (toggle in top right)
4. **Click "Load unpacked"** and select this extension folder
5. **Extension ready!** Click the icon in your toolbar

### First Use
1. **Open side panel** by clicking the extension icon
2. **Start voice chat** with the microphone button
3. **Grant permissions** when prompted (one-time setup)
4. **Ask questions** about products on any shopping site!

## 🎤 Voice System

### Simplified Architecture (Post-Optimization)
- **Primary Method**: Web Speech API for real-time transcription
- **Permission System**: Iframe-based for cross-domain compatibility
- **No External APIs**: Fully browser-native, no API keys needed
- **Auto-Recovery**: Smart restart and comprehensive error handling

### Browser Compatibility
| Browser | Voice Support | Status |
|---------|--------------|--------|
| Chrome  | ✅ Full | **Recommended** |
| Edge    | ✅ Full | **Recommended** |
| Firefox | ⚠️ Limited | Basic functionality |
| Safari  | ❌ None | Text input only |

### Voice Features
- **Continuous Listening** - Auto-restart for natural conversation
- **Live Feedback** - See transcription as you speak
- **Smart Error Recovery** - Helpful tips for common issues
- **Permission Management** - Seamless cross-site microphone access

## 🛠️ Technical Implementation

### Optimized Architecture (70% Code Reduction)
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Side Panel    │    │   Background    │    │ Content Script  │
│  (sidepanel.*)  │◄──►│ (background.js) │◄──►│(mic-permission.*│
│                 │    │                 │    │                 │
│ • Voice UI      │    │ • Query routing │    │ • Permissions   │
│ • Web Speech API│    │ • Intent parsing│    │ • Page analysis │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key Components

#### Background Service (`background.js`)
- **BackgroundService**: Clean class-based message routing
- **MicrophonePermission**: Iframe-based permission handling  
- **ShoppingAssistant**: Intent-based query processing with contextual responses

#### Voice Handler (`voice-handler.js`)
- **Web Speech API Integration**: Real-time browser-native transcription
- **Enhanced Error Handling**: User-friendly messages with recovery tips
- **State Management**: Robust listening state with auto-restart logic

#### UI Components (`sidepanel.*`)
- **Modern CSS**: Custom properties, organized component structure
- **Responsive Design**: Clean chat interface with voice button
- **Visual Feedback**: Live transcription and listening indicators

### File Structure
```
shopping_chrome_extension/
├── manifest.json                # Extension configuration
├── background.js               # Service worker (optimized)
├── content.js                  # Page analysis
├── mic-permission.js          # Permission content script  
├── mic-permission-page.*      # Permission iframe resources
├── sidepanel.*               # Main UI (HTML/JS/CSS)
├── voice-handler.js          # Voice input (Web Speech API)
├── docs/                     # Technical documentation
│   ├── VOICE_SYSTEM.md      # Voice implementation details
│   └── CLAUDE.md            # Development guidelines  
└── icons/                   # Extension icons
```

## 🎯 Optimization Highlights

### Performance Improvements
- **Faster Startup**: No external API initialization
- **Lower Memory**: Removed persistent offscreen documents  
- **Better Reliability**: Browser-native voice recognition
- **Enhanced UX**: Improved error recovery and user feedback

### Code Quality Enhancements
- **Class-based Architecture**: Clear separation of concerns
- **CSS Custom Properties**: Maintainable styling system
- **Enhanced Error Handling**: Comprehensive error types with recovery guidance
- **Consistent Naming**: Improved file organization and conventions

### Removed Complexity
- ❌ External API dependencies (Cartesia/OpenAI)
- ❌ MediaRecorder + offscreen document system
- ❌ Multiple permission methods  
- ❌ All debugging and test files
- ❌ Complex dual-system approach

## 🐛 Troubleshooting

### Voice Input Issues

**"Microphone access denied"**
- Click microphone icon in browser address bar
- Select "Allow" for microphone access
- Refresh page and try again

**"Voice input not working"**
- Ensure you're using Chrome or Edge browser
- Check that microphone is connected and working
- Try on a different website (some sites block extensions)

**"No speech detected"**
- Speak clearly and closer to microphone
- Check microphone volume in system settings
- Ensure other apps aren't using microphone

### Extension Issues

**Side panel not opening**
- Right-click extension icon → select "Show side panel"
- Try reloading the extension in chrome://extensions/

**Not working on certain sites**
- Some sites (banking, etc.) block extension content scripts
- Try the extension on shopping sites like Amazon, eBay

## 🤝 Contributing

This extension follows clean coding practices:
- Modular architecture with single responsibility principle
- Comprehensive error handling and user feedback
- Modern CSS with custom properties
- Class-based JavaScript with clear method organization

See `docs/CLAUDE.md` for development guidelines and `docs/VOICE_SYSTEM.md` for technical voice implementation details.

## 📝 License

MIT License - feel free to use and modify as needed.

---

**Built with modern web technologies and optimized for performance and reliability.** 🚀