# Refactoring Plan: ConversationHandler → Modular Architecture

## Overview

-   **Goal**: Split `ConversationHandler` into modular components for better separation of concerns
-   **No Logic Changes**: Only reorganization for modularity and clarity
-   **New Architecture**: 4 focused handlers + 1 orchestrator

## New Architecture

### File Structure

```
src/services/
├── multimedia-orchestrator.js    # NEW: Red button management
├── audio-handler.js              # NEW: Audio processing
├── video-handler.js              # NEW: Video processing
├── ai-handler.js                 # MODIFIED: Both Gemini + REST API
├── conversation-handler.js       # REMOVE: Current monolithic file
├── conversation-manager.js       # EXISTING: Message history (unchanged)
├── audio/                        # EXISTING: Audio services (unchanged)
└── screen-capture/               # EXISTING: Screen capture services (unchanged)
```

### Responsibility Split

-   **MultimediaOrchestrator**: Red button management and coordination
-   **AudioHandler**: Audio capture, processing, and speech recognition
-   **VideoHandler**: Video capture, screen recording, and tab management
-   **AIHandler**: Both Gemini (multimedia) + REST API (text) integration
-   **ConversationManager**: Message history (unchanged)

## Detailed New Flow and Architecture

### 🎯 **New Data Flow Architecture**

#### **1. Red Button Flow (Multimedia Session)**

```
User clicks red button
    ↓
MultimediaOrchestrator.startMultimedia()
    ↓
├── AIHandler.connectToGemini()
├── AudioHandler.startAudioCapture()
└── VideoHandler.startVideoCapture()
    ↓
Real-time streaming begins:
├── AudioHandler → AIHandler.sendAudioData() → Gemini
├── VideoHandler → AIHandler.sendVideoData() → Gemini
└── Gemini responses → UI updates
```

#### **2. Text Input Flow (Always Available)**

```
User types text message
    ↓
AIHandler.sendTextMessage()
    ↓
REST API call
    ↓
Response → ConversationManager.addMessage() → UI update
```

#### **3. Session End Flow**

```
User clicks red button again
    ↓
MultimediaOrchestrator.stopMultimedia()
    ↓
├── AudioHandler.stopAudioCapture()
├── VideoHandler.stopVideoCapture()
└── AIHandler.disconnectFromGemini()
    ↓
Multimedia session ends, but conversation continues
```

#### **4. New Chat Flow**

```
User clicks "Start new chat"
    ↓
ConversationManager.clearConversation()
    ↓
Reset all state and start fresh conversation
```

### 🏗️ **Detailed File Structure and Responsibilities**

#### **📁 src/services/multimedia-orchestrator.js** (NEW)

**Purpose**: Coordinates the red button functionality and manages multimedia session state

**Key Methods**:

-   `startMultimedia()` - Initiates multimedia session
-   `stopMultimedia()` - Ends multimedia session
-   `isMultimediaActive()` - Returns session state

**Dependencies**:

-   AudioHandler (for audio operations)
-   VideoHandler (for video operations)
-   AIHandler (for Gemini connection)

**State Management**:

-   Tracks whether multimedia session is active
-   Coordinates between all handlers
-   Manages session lifecycle

#### **📁 src/services/audio-handler.js** (NEW)

**Purpose**: Handles all audio-related operations including capture, processing, and speech recognition

**Key Methods**:

-   `startAudioCapture()` - Begin audio capture
-   `stopAudioCapture()` - Stop audio capture
-   `startAudioStreaming()` - Start audio streaming to AI
-   `stopAudioStreaming()` - Stop audio streaming
-   `startLocalSpeechRecognition()` - Begin speech recognition
-   `startEndpointDetection()` - Begin silence detection
-   `onAudioLevelDetected()` - Handle audio level changes

**Dependencies**:

-   AudioCaptureService (from audio/)
-   SpeechRecognitionService (from audio/)
-   EndpointDetectionService (from audio/)
-   AudioStateManager (from audio/)
-   AIHandler (for sending audio data)

**Data Flow**:

-   Captures microphone audio
-   Processes audio through speech recognition
-   Detects speech endpoints and silence
-   Sends processed audio to AIHandler

#### **📁 src/services/video-handler.js** (NEW)

**Purpose**: Handles all video-related operations including screen capture, recording, and tab management

**Key Methods**:

-   `startVideoCapture()` - Begin screen capture
-   `stopVideoCapture()` - Stop screen capture
-   `startScreenshotStreaming()` - Start video streaming to AI
-   `stopScreenshotStreaming()` - Stop video streaming
-   `setupTabSwitching()` - Handle tab changes
-   `handleScreenCaptureFailure()` - Handle capture failures
-   `recoverFromInvalidTab()` - Recover from invalid tabs

**Dependencies**:

-   ScreenCaptureService (from screen-capture/)
-   LivePreviewManager (from services/)
-   AIHandler (for sending video data)

**Data Flow**:

-   Captures screen content
-   Handles tab switching and page changes
-   Manages debugger attachments
-   Sends video frames to AIHandler

#### **📁 src/services/ai-handler.js** (MODIFIED)

**Purpose**: Manages all AI interactions including both Gemini (multimedia) and REST API (text)

**Key Methods**:

-   **Gemini Methods**:

    -   `connectToGemini()` - Connect to Gemini for multimedia
    -   `disconnectFromGemini()` - Disconnect from Gemini
    -   `sendAudioData()` - Send audio to Gemini
    -   `sendVideoData()` - Send video to Gemini
    -   `isGeminiConnected()` - Check Gemini connection

-   **REST API Methods**:

    -   `sendTextMessage()` - Send text via REST API
    -   `getTextResponse()` - Get text response

-   **Common Methods**:
    -   `isConnected()` - Overall AI connection status

**Dependencies**:

-   GeminiLiveAPI (existing)
-   REST API client (existing)

**Data Flow**:

-   Routes multimedia data to Gemini
-   Routes text messages to REST API
-   Manages connection states for both

#### **📁 src/services/conversation-manager.js** (EXISTING - UNCHANGED)

**Purpose**: Manages conversation history and message storage

**Key Methods**:

-   `addMessage()` - Add message to history
-   `getMessages()` - Get conversation history
-   `clearConversation()` - Clear all history
-   `getContextForAPI()` - Get context for AI

**Data Flow**:

-   Stores all messages (text, audio, video responses)
-   Provides conversation context to AI
-   Manages conversation persistence

### 🔄 **Component Interaction Flow**

#### **Initialization Flow**

```
app.js constructor
    ↓
├── new AudioHandler(aiHandler)
├── new VideoHandler(aiHandler)
├── new AIHandler()
└── new MultimediaOrchestrator(audioHandler, videoHandler, aiHandler)
    ↓
Register callbacks and event listeners
```

#### **Red Button Press Flow**

```
User clicks red button
    ↓
EventManager.handleVoiceInput()
    ↓
MultimediaOrchestrator.startMultimedia()
    ↓
├── AIHandler.connectToGemini()
├── AudioHandler.startAudioCapture()
└── VideoHandler.startVideoCapture()
    ↓
Real-time streaming begins
```

#### **Text Message Flow**

```
User types text
    ↓
EventManager.handleSendMessage()
    ↓
AIHandler.sendTextMessage()
    ↓
REST API call
    ↓
ConversationManager.addMessage()
    ↓
UI update
```

#### **Multimedia Data Flow**

```
Audio/Video capture
    ↓
AudioHandler/VideoHandler process data
    ↓
AIHandler.sendAudioData() / sendVideoData()
    ↓
Gemini processes and responds
    ↓
ConversationManager.addMessage()
    ↓
UI update
```

### 🎯 **Key Architectural Principles**

#### **1. Separation of Concerns**

-   **MultimediaOrchestrator**: Only manages red button state and coordination
-   **AudioHandler**: Only handles audio operations
-   **VideoHandler**: Only handles video operations
-   **AIHandler**: Only handles AI interactions
-   **ConversationManager**: Only handles message history

#### **2. Clear Data Flow**

-   Multimedia data flows through specific handlers
-   Text data flows directly to AIHandler
-   All responses go through ConversationManager
-   UI updates happen through existing mechanisms

#### **3. State Management**

-   Multimedia state is managed by MultimediaOrchestrator
-   Conversation state is managed by ConversationManager
-   Individual handler states are managed internally
-   No shared state between handlers

#### **4. Error Handling**

-   Each handler manages its own errors
-   MultimediaOrchestrator coordinates error recovery
-   Failures in one handler don't affect others
-   Graceful degradation when possible

### 🔧 **Integration Points**

#### **With Existing UI**

-   Red button state managed by MultimediaOrchestrator
-   Text input always available through AIHandler
-   Message display through existing ConversationManager
-   Status updates through existing callback system

#### **With Existing Services**

-   Audio services (audio/) used by AudioHandler
-   Screen capture services (screen-capture/) used by VideoHandler
-   Gemini API used by AIHandler
-   Storage services used by ConversationManager

#### **With Core Components**

-   EventManager uses MultimediaOrchestrator for red button
-   LifecycleManager uses MultimediaOrchestrator for session state
-   App.js coordinates all handlers
-   Background script remains unchanged

### 📊 **Migration Strategy**

#### **Phase 1: Create New Handlers**

-   Extract methods from ConversationHandler to new handlers
-   Maintain all existing functionality
-   Test each handler independently

#### **Phase 2: Update Integration**

-   Update core components to use new handlers
-   Maintain existing APIs where possible
-   Test integration points

#### **Phase 3: Clean Up**

-   Remove ConversationHandler
-   Update all references
-   Verify no functionality is lost

This architecture provides clear separation of concerns, better testability, and improved maintainability while preserving all existing functionality.


## Verification Checklist

After each phase, verify:

### Phase 1 Verification

-   [ ] All new handler files created
-   [ ] All methods moved to appropriate handlers
-   [ ] All imports and dependencies resolved
-   [ ] No syntax errors in new files

### Phase 2 Verification

-   [ ] All import statements updated
-   [ ] All constructor parameters updated
-   [ ] No broken import references
-   [ ] All files compile without errors

### Phase 3 Verification

-   [ ] All method calls updated
-   [ ] Red button functionality works
-   [ ] Text input functionality works
-   [ ] No console errors

### Phase 4 Verification

-   [ ] conversation-handler.js removed
-   [ ] No remaining old references
-   [ ] All functionality preserved
-   [ ] UI works as expected

## Final Architecture Benefits

1. **Clear Separation of Concerns**: Each handler has a single responsibility
2. **Better Testability**: Can test each component independently
3. **Improved Maintainability**: Changes to one area don't affect others
4. **Future Flexibility**: Easy to swap or extend individual components
5. **Clear Naming**: No confusion between conversation and multimedia concepts

## Notes

-   **No Logic Changes**: All existing functionality must be preserved
-   **Gradual Migration**: Each phase should be completed and tested before moving to the next
-   **Backward Compatibility**: Ensure all existing features work exactly the same
-   **Error Handling**: Maintain all existing error handling and recovery mechanisms











## Step-by-Step Refactoring Process

### Phase 1: Create New Handler Files

#### Step 1.1: Create AudioHandler

**File**: `src/services/audio-handler.js`

**Move from conversation-handler.js**:

-   `startAudioStreaming()`
-   `stopAudioStreaming()`
-   `startAudioWorkletProcessing()`
-   `startScriptProcessorFallback()`
-   `stopAudioProcessing()`
-   `startLocalSpeechRecognition()`
-   `restartSpeechRecognition()`
-   `startSpeechKeepAlive()`
-   `clearSpeechKeepAlive()`
-   `startEndpointDetection()`
-   `stopEndpointDetection()`
-   `resetSilenceTimer()`
-   `clearSilenceTimer()`
-   `onSpeechDetected()`
-   `onAudioLevelDetected()`
-   `handleSilenceDetected()`
-   `handleWebSpeechFinalResult()`
-   `resetInactivityTimer()`
-   `clearInactivityTimer()`

**Constructor dependencies**:

-   Import AudioCaptureService, SpeechRecognitionService, EndpointDetectionService, AudioStateManager
-   Accept AIHandler as parameter for sending audio data

#### Step 1.2: Create VideoHandler

**File**: `src/services/video-handler.js`

**Move from conversation-handler.js**:

-   `startScreenshotStreaming()`
-   `stopScreenshotStreaming()`
-   `setupTabSwitching()`
-   `cleanupTabListeners()`
-   `handleScreenCaptureFailure()`
-   `handleTabSwitchFailure()`
-   `recoverFromInvalidTab()`
-   `checkAndSwitchToActiveTab()`

**Constructor dependencies**:

-   Import ScreenCaptureService, LivePreviewManager
-   Accept AIHandler as parameter for sending video data

#### Step 1.3: Create MultimediaOrchestrator

**File**: `src/services/multimedia-orchestrator.js`

**New orchestration methods**:

-   `startMultimedia()` - Coordinates starting audio, video, and AI
-   `stopMultimedia()` - Coordinates stopping audio, video, and AI
-   `isMultimediaActive()` - Returns multimedia session state

**Constructor dependencies**:

-   Accept AudioHandler, VideoHandler, AIHandler as parameters
-   Manage multimedia session state

#### Step 1.4: Modify AIHandler

**File**: `src/services/ai-handler.js`

**Add Gemini methods**:

-   `connectToGemini()`
-   `disconnectFromGemini()`
-   `isGeminiConnected()`
-   `sendAudioData()`
-   `sendVideoData()`

**Add REST API methods**:

-   `sendTextMessage()` (existing, but clarify it's for REST API)
-   `getTextResponse()`

**Add common methods**:

-   `isConnected()` - Overall AI connection status
-   `isGeminiConnected()` - Gemini-specific connection status

### Phase 2: Update Import Statements

#### Step 2.1: Update app.js

**File**: `src/core/app.js`

**Changes needed**:

-   Remove import of ConversationHandler
-   Add imports for MultimediaOrchestrator, AudioHandler, VideoHandler, AIHandler
-   Update constructor to create new handlers
-   Update method calls to use MultimediaOrchestrator instead of ConversationHandler

#### Step 2.2: Update event-manager.js

**File**: `src/core/event-manager.js`

**Changes needed**:

-   Update constructor parameter from conversationHandler to multimediaOrchestrator
-   Update all method calls from conversationHandler to multimediaOrchestrator
-   Update method names: startConversation → startMultimedia, etc.

#### Step 2.3: Update lifecycle-manager.js

**File**: `src/core/lifecycle-manager.js`

**Changes needed**:

-   Update constructor parameter from conversationHandler to multimediaOrchestrator
-   Update all method calls from conversationHandler to multimediaOrchestrator
-   Update method names: startConversation → startMultimedia, etc.

### Phase 3: Update Method Calls

#### Step 3.1: Update Red Button Logic

**Files affected**: `src/core/event-manager.js`, `src/core/app.js`

**Changes needed**:

-   Replace `startConversation()` calls with `startMultimedia()`
-   Replace `stopConversation()` calls with `stopMultimedia()`
-   Replace `isConversationActive()` calls with `isMultimediaActive()`

#### Step 3.2: Update Text Message Flow

**Files affected**: `src/core/event-manager.js`, `src/core/app.js`

**Changes needed**:

-   Ensure text messages go directly to AIHandler.sendTextMessage()
-   Remove any text message handling from multimedia orchestration
-   Keep text input always available regardless of multimedia state

#### Step 3.3: Update Status and Callback Handling

**Files affected**: All core files

**Changes needed**:

-   Update callback registrations to use new handler structure
-   Update status checks to use multimedia state instead of conversation state
-   Ensure UI state management works with new architecture

### Phase 4: Clean Up

#### Step 4.1: Remove conversation-handler.js

**Action**: Delete `src/services/conversation-handler.js`

**Verification**: Ensure no remaining imports reference this file

#### Step 4.2: Update all remaining references

**Files to check**:

-   Search entire codebase for any remaining `conversationHandler` references
-   Search for any remaining `startConversation`, `stopConversation`, `isConversationActive` method calls
-   Update any remaining references to use new naming

#### Step 4.3: Verify file structure

**Check**:

-   All new files exist and are properly structured
-   All import statements resolve correctly
-   No broken references remain

## Method Name Changes

### Old → New

-   `startConversation()` → `startMultimedia()`
-   `stopConversation()` → `stopMultimedia()`
-   `isConversationActive()` → `isMultimediaActive()`

### Variable Name Changes

-   `conversationHandler` → `multimediaOrchestrator`
-   `audioHandler` → `audioHandler` (unchanged)
-   `videoHandler` → `videoHandler` (unchanged)
-   `aiHandler` → `aiHandler` (unchanged)

## Data Flow Changes

### Before (Monolithic)

```
Red Button → ConversationHandler.startConversation()
Text Input → ConversationHandler (mixed with multimedia)
```

### After (Modular)

```
Red Button → MultimediaOrchestrator.startMultimedia()
├── AudioHandler.startAudioCapture()
├── VideoHandler.startVideoCapture()
└── AIHandler.connectToGemini()

Text Input → AIHandler.sendTextMessage() (always available)
```
