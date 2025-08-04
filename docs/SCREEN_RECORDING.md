# Voice-Triggered Screen Recording

This feature automatically captures screen recordings during voice input sessions, creating videos that combine screenshots at 1 FPS with synchronized audio.

## How It Works

1. **Voice Detection**: When the user starts speaking, the system automatically begins screen recording
2. **Screen Capture**: Screenshots are captured at 1 FPS (once per second) during the entire speech duration
3. **Audio Recording**: High-quality audio is recorded simultaneously with the screen captures
4. **Video Creation**: When speech ends, screenshots and audio are combined into a WebM video file
5. **Automatic Download**: The completed video is automatically downloaded to the user's device

## Technical Implementation

### Components

- **VoiceInputHandler**: Enhanced to trigger screen recording on speech detection
- **ScreenRecorder**: New service that handles screen capture and video creation
- **Chrome Extension Integration**: Uses desktopCapture API for screen access

### Key Features

- **Automatic Start/Stop**: Recording begins when speech is detected and ends when speech stops
- **1 FPS Capture Rate**: Optimized for performance while maintaining visual continuity  
- **Audio Synchronization**: Audio and video are perfectly synchronized
- **WebM Format**: Creates web-compatible video files
- **Error Handling**: Graceful fallbacks and error recovery

## Usage

### In Extension Context
The screen recording is automatically integrated with the existing voice input system. No additional setup required.

### Testing
Use the `test-screen-recording.html` file to test the functionality:

1. Open the HTML file in Chrome
2. Click "Start Voice Recognition"
3. Grant microphone and screen sharing permissions
4. Start speaking - screen recording begins automatically
5. Stop speaking - video is created and downloaded

## Permissions Required

The extension manifest includes these permissions:
- `desktopCapture`: For screen recording access
- Microphone access: For audio recording during speech

## File Formats

- **Video**: WebM format with VP9 codec
- **Audio**: WebM format with Opus codec  
- **Screenshots**: JPEG format (intermediate processing)

## Performance Considerations

- **1 FPS Rate**: Minimizes resource usage while maintaining usability
- **Automatic Cleanup**: Memory and resources are freed after video creation
- **Efficient Processing**: Uses Canvas API for optimized screenshot processing

## Error Handling

The system handles various error scenarios:
- Permission denied for screen or microphone access
- Screen capture API unavailability  
- Audio recording failures
- Video creation errors

## Browser Compatibility

- **Chrome/Chromium**: Full support with desktopCapture API
- **Other Browsers**: Fallback to getDisplayMedia API (requires user interaction)
- **Extension Context**: Optimal performance with Chrome extension APIs

## Future Enhancements

Potential improvements:
- Variable frame rates based on activity
- Multiple screen/window selection
- Video compression options
- Cloud storage integration
- Real-time streaming capabilities