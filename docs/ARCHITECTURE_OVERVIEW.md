
### High-level system architecture

- Extension side panel initializes core managers:
  - UI: `UIManager`, `ConversationRenderer`, `UIState`
  - Control: `EventManager`, `LifecycleManager`
  - Orchestration: `MultimediaOrchestrator` coordinating `AudioHandler` and `VideoHandler`
  - Networking: `ServerClient` wrapping `ServerWsClient`

- Streaming flow:
  - Audio: `AudioWorkletNode` -> PCM base64 -> `audioChunk` to backend with sample-accurate timestamps
  - Video: `captureVisibleTab` -> base64 JPEG -> `imageFrame` to backend first, then preview update
  - Links/Tab Info: content scripts collect links; background rebroadcasts; orchestrator sends `links` and `tabInfo` messages with session-relative timestamps

- Backend:
  - FastAPI WebSocket `/ws` accepts `init`, `imageFrame`, `audioChunk`, `text`, `links`, `tabInfo`, `control`
  - Server VAD segments audio; emits `status` (speaking/segment_closed)
  - Segment finalization encodes video/audio and calls `gemini_client`; server emits `segment`, `transcript`, and `response`

### Flow diagram
The following diagram shows the main components and data flow.

[Mermaid diagram rendered below]

- Key message shapes:
  - Client → Server: `init`, `imageFrame`, `audioChunk`, `text`, `links`, `tabInfo`, `control`
  - Server → Client: `ack`, `status`, `config(captureFps)`, `transcript`, `segment`, `response`, `error`

- Important behaviors:
  - Default capture 1 FPS; server can override via `config.captureFps`
  - Frame send prioritized over preview update
  - Session clock used for consistent timestamps
  - Side panel lifecycle connects on open, disconnects on close

- Optional next steps:
  - Add auto-reconnect/backoff to websocket client
  - Document this diagram in `docs/ARCHITECTURE_SERVER_WS.md` or a new `docs/ARCHITECTURE.v2.md`

### Diagram

```mermaid
graph LR
  %% Layout
  classDef comp fill:#fff,stroke:#333,stroke-width:1px;

  subgraph "Side Panel (UI)"
    UI["UIManager<br/>ConversationRenderer<br/>UIState"]:::comp
    EM["EventManager"]:::comp
    LM["LifecycleManager"]:::comp
  end

  subgraph "Orchestration"
    MO["MultimediaOrchestrator"]:::comp
    AH["AudioHandler<br/>AudioCaptureService (AudioWorkletNode)"]:::comp
    VH["VideoHandler (Facade)<br/>ScreenCaptureService<br/>StaticScreenshotService<br/>StaticWindowTracker"]:::comp
  end

  subgraph "Networking"
    SC["ServerClient<br/>(wraps ServerWsClient)"]:::comp
  end

  subgraph "Background"
    BG["background.js"]:::comp
  end

  subgraph "Content Scripts"
    CS["content scripts<br/>mouse-event / activity-consumer<br/>node-selector"]:::comp
  end

  subgraph "Backend"
    WS["FastAPI WebSocket /ws<br/>ConnectionState + status_task"]:::comp
    SVAD["ServerRmsVadSegmenter"]:::comp
    ENC["media_encoder.encode_segment"]:::comp
    GC["gemini_client (video/audio/image)"]:::comp
  end

  %% UI and lifecycle
  UI <--> EM
  LM --> SC
  LM -- "connect on open / disconnect on close" --> SC

  %% Start/stop voice
  EM --> MO
  MO <--> AH
  MO <--> VH

  %% Streaming paths
  AH -- "audioChunk { base64, tsStartMs, numSamples, sampleRate }" --> SC
  VH -- "imageFrame { base64, tsMs }" --> SC

  %% Links & tab info
  CS -- "MOUSE_BUCKET → unique hrefs" --> BG
  BG -- "broadcast links" --> MO
  MO -- "sendLinks { links, tsMs }" --> SC

  MO -- "REQUEST_TAB_INFO" --> CS
  CS -- "{ info, captureTsAbsMs }" --> MO
  MO -- "sendTabInfo { info, tsMs }" --> SC

  %% WebSocket
  SC <--> WS
  WS -- "ack / status / config / transcript / segment / response" --> SC

  %% Backend processing
  WS --> SVAD
  SVAD -- "speaking / segment_closed" --> WS
  WS -- "finalize_segment" --> ENC
  ENC --> GC
  GC -- "responseText" --> WS

  %% UI consumption
  SC -- "responses / transcripts / status" --> UI
```

If your renderer does not support Mermaid, view the static SVG:

![Architecture](./architecture_flow_dragram.svg)

