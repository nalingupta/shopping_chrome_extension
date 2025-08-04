# Voice Input Implementation

## Overview
This implementation follows the recommended approach for robust microphone access in Chrome extensions:
1. Request mic permission via content script with iframe
2. Use offscreen document for persistent audio capture
3. Control recording from sidePanel UI via messages

## Architecture

### 1. Permission Request Flow
- `micPermission.js` (content script) - Injects iframe to request permission
- `permissionRequest.html/js` - Extension page loaded in iframe for getUserMedia

### 2. Audio Capture
- `offscreen.html/js` - Persistent document that maintains audio stream
- Survives sidebar closures and tab switches
- Keeps mic stream alive between recordings

### 3. Control Flow
- `voiceInput.js` - Handles recording control from sidePanel
- `background.js` - Routes messages between components
- `sidepanel.js` - UI controls for voice input

## Message Flow

1. **Request Permission**:
   - SidePanel → Background → Content Script → Iframe → getUserMedia
   
2. **Start Recording**:
   - SidePanel → Background → Offscreen (INIT_AUDIO then START_RECORDING)
   
3. **Audio Data**:
   - Offscreen → Background → SidePanel → Transcription

## Key Features

- **Persistent Audio**: Offscreen document keeps stream alive
- **Cross-tab Support**: Works across all tabs and domains
- **Robust Permissions**: Handles permission flow correctly
- **Error Handling**: Comprehensive error messages for users

## Testing

Use `test_voice_flow.html` to test:
1. Permission request
2. Offscreen document status
3. Full recording flow

## Files Modified/Created

- `micPermission.js` - New content script for permission
- `permissionRequest.html/js` - New permission request page
- `offscreen.js` - Rewritten for persistent audio
- `voiceInput.js` - Updated for new flow
- `background.js` - Added permission and offscreen management
- `manifest.json` - Updated permissions and resources
- `test_voice_flow.html` - Test page for debugging