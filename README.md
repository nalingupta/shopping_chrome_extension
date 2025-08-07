# Shopping Chrome Extension

An AI-powered shopping assistant Chrome extension with voice and visual input capabilities.

## Features

-   **Voice Input**: Speak to the assistant using your microphone
-   **Visual Context**: The assistant can see what's on your screen to provide relevant shopping advice
-   **AI-Powered**: Powered by Google's Gemini AI for intelligent responses
-   **Cross-Window Synchronization**: Conversation history and state are synchronized across all Chrome windows
-   **Real-time Updates**: Changes in one window are immediately reflected in all other windows

## Cross-Window Synchronization

The extension now features seamless cross-window conversation synchronization:

### What's Synchronized

-   **Conversation History**: All chat messages are shared across windows
-   **AI Context**: The assistant maintains context across all windows
-   **Welcome Screen State**: UI state is consistent across windows

### How It Works

-   Uses `chrome.storage.sync` for cross-window data sharing
-   Real-time updates via Chrome's storage change events
-   Automatic migration from old localStorage data
-   Broadcast messaging for immediate UI updates

### Benefits

-   Start a conversation in one window, continue in another
-   AI remembers context from previous windows
-   Consistent experience across all Chrome windows
-   No lost conversations when switching windows

## Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

## Usage

1. Click the extension icon to open the side panel
2. Use voice input by clicking the microphone button
3. Type messages in the text input
4. The assistant will analyze your screen and provide shopping advice

## Development

The extension uses a unified conversation management system:

-   `UnifiedConversationManager`: Single source of truth for all conversation data
-   Cross-window synchronization via Chrome storage APIs
-   Real-time UI updates across all windows
-   Automatic data migration from legacy systems

## Technical Details

### Architecture

-   **Background Script**: Handles cross-window messaging and state management
-   **Side Panel**: Main UI for user interaction
-   **Content Script**: Captures page information and screen data
-   **Services**: Modular services for audio, screen capture, and AI integration

### Storage

-   `chrome.storage.sync`: Cross-window conversation data
-   `chrome.storage.local`: Extension-specific settings
-   Automatic cleanup and migration utilities

### Cross-Window Communication

-   Chrome runtime messaging for real-time updates
-   Storage change listeners for automatic synchronization
-   Broadcast messaging for immediate UI refresh
