# Voice Input Setup Instructions

## Current Issue

The voice input is showing mock responses instead of transcribing your actual speech.

## Solution Steps

### 1. Reload the Extension

The extension needs to be reloaded to pick up the new API key configuration:

1. Go to `chrome://extensions/`
2. Find "Shopping Assistant" in the list
3. Click the refresh button (🔄) on the extension card
4. Wait for the extension to reload

### 2. Test Voice Input

1. Open the extension side panel
2. Click the microphone button (🎤)
3. Speak into your microphone
4. Click the microphone button again to stop recording

### 3. Check Console Logs

If it's still not working, check the browser console:

1. Press F12 to open Developer Tools
2. Go to the Console tab
3. Look for messages starting with "VoiceInputHandler initialized with:"
4. Check if the API key is being loaded correctly

### 4. Debug Page

You can also use the debug page to test step by step:

1. Open `debug_voice.html` in your browser
2. Click "Check Config" to verify the API key is loaded
3. Click "Test Voice Handler" to create the voice handler
4. Click "Test Recording" to test the recording flow

## Expected Behavior

After reloading the extension:

-   The microphone button should turn red (🔴) when recording
-   Your speech should be transcribed and appear in the input field
-   The transcription should be sent as a message automatically

## If Still Not Working

1. Make sure you're on a secure website (HTTPS)
2. Check that microphone permissions are granted
3. Try refreshing the page and testing again
4. Check the console for any error messages

## API Key Verification

The API key should start with `sk_car_` and be loaded from `config.js`. If you see placeholder values like `YOUR_CARTESIA_API_KEY_HERE`, the config file is not being loaded properly.
