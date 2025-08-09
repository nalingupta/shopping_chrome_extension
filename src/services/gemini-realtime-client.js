import { API_CONFIG } from "../config/api-keys.js";
import { streamingLogger } from "../utils/streaming-logger.js";
import { SYSTEM_PROMPT } from "../prompt/system-prompt.js";
import { ContextAssembler } from "./prompt/context-assembler.js";

export class GeminiRealtimeClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.isSetupComplete = false;
        this.audioContext = null;
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
        this.responseQueue = [];
        this.currentTurn = [];
        this.isProcessingTurn = false;
        this.currentStreamingResponse = ""; // Track streaming response
        this.isStreaming = false; // Track if we're currently streaming
        this.callbacks = {
            onBotResponse: null,
            onConnectionStateChange: null,
            onError: null,
            onStreamingUpdate: null, // Optional: for real-time streaming updates
        };
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.isManualStop = false;
        this.audioInputEnabled = false;
        this._connectSeq = 0; // debug: connection attempts

        // Utterance-level diagnostics
        this._utteranceCounters = {
            audioChunks: 0,
            videoFrames: 0,
            firstAudioAt: null,
            firstVideoAt: null,
        };

        // Per-turn aggregated stats (for TurnSummary logs)
        this._turnSeq = 0;
        this._turnStats = {
            audioChunks: 0,
            audioBytes: 0,
            screens: 0,
            screenBytes: 0,
            userText: "",
        };

        // Snapshot of conversation history sent at setupComplete
        this._historySent = null;
        // Utterances captured within the active WS session
        this._sessionUtterances = [];
        // Guard to avoid double persistence on close + manual disconnect
        this._hasPersistedUtterances = false;
        // Suppress user capture when sending history payloads
        this._suppressUserCapture = false;
    }

    async initialize() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext ||
                    window.webkitAudioContext)({
                    sampleRate: 16000,
                });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async connect() {
        if (this.isConnected) {
            return { success: true };
        }

        return new Promise((resolve, reject) => {
            try {
                this.isManualStop = false;
                this.isSetupComplete = false;
                this.pendingAudioChunks = [];
                this.pendingVideoFrames = [];

                const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_CONFIG.GEMINI_API_KEY}`;

                // Debug: mark new connection attempt
                this._connectSeq += 1;
                try {
                    console.debug(
                        `[RealtimeClient] connect() attempt #${this._connectSeq}`
                    );
                } catch (_) {}

                this.ws = new WebSocket(wsUrl);
                this.ws.binaryType = "blob";

                this.ws.onopen = async () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this._hasPersistedUtterances = false;
                    this._sessionUtterances = [];

                    // Ensure AudioContext is running after previous suspend on disconnect
                    try {
                        if (
                            this.audioContext &&
                            this.audioContext.state === "suspended"
                        ) {
                            await this.audioContext.resume();
                        }
                    } catch (resumeError) {
                        console.warn(
                            "AudioContext resume failed:",
                            resumeError
                        );
                    }

                    await new Promise((resolve) => setTimeout(resolve, 100));
                    this.sendConfiguration();
                    this.startKeepAlive();

                    // Start streaming logger
                    streamingLogger.start();

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("connected");
                    }
                    resolve({ success: true });
                };

                this.ws.onmessage = async (event) => {
                    let data;
                    if (event.data instanceof Blob) {
                        data = await event.data.text();
                    } else {
                        data = event.data;
                    }
                    this.handleMessage(data);
                };

                this.ws.onerror = (error) => {
                    try {
                        console.error("Gemini WS error:", error);
                    } catch (_) {}
                    if (this.callbacks.onError) {
                        this.callbacks.onError(error);
                    }
                    reject(new Error("WebSocket connection failed"));
                };

                this.ws.onclose = (event) => {
                    this.isConnected = false;
                    this.isSetupComplete = false;
                    this.stopKeepAlive();
                    this.clearBuffers();

                    // Stop streaming logger
                    streamingLogger.stop();

                    try {
                        console.warn(
                            `Gemini WS closed: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
                        );
                        // On session end, persist captured utterances to conversation history
                        if (
                            this._sessionUtterances &&
                            this._sessionUtterances.length > 0
                        ) {
                            const total = this._sessionUtterances.length;
                            console.debug(
                                `[RealtimeClient] Utterances (${total})`
                            );
                            this._sessionUtterances.forEach((u, idx) => {
                                const up = JSON.stringify(
                                    (u.user || "").slice(0, 120)
                                );
                                const ap = JSON.stringify(
                                    (u.assistant || "").slice(0, 120)
                                );
                                console.debug(
                                    `[RealtimeClient] Utterance ${
                                        idx + 1
                                    } | user=${up} | output=${ap}`
                                );
                            });
                            // Persist async once (do not block close)
                            if (!this._hasPersistedUtterances) {
                                this._hasPersistedUtterances = true;
                                this.#persistSessionUtterances();
                            }
                        }
                    } catch (_) {}

                    if (this.callbacks.onConnectionStateChange) {
                        this.callbacks.onConnectionStateChange("disconnected");
                    }

                    if (
                        !this.isManualStop &&
                        this.reconnectAttempts < this.maxReconnectAttempts
                    ) {
                        this.scheduleReconnection();
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    sendConfiguration() {
        const setupMessage = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                systemInstruction: {
                    parts: [
                        {
                            text: SYSTEM_PROMPT,
                        },
                    ],
                },
                // Disable server-side automatic VAD; we will send explicit activityStart/activityEnd
                realtimeInputConfig: {
                    automaticActivityDetection: {
                        disabled: true,
                    },
                },
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                    candidateCount: 1,
                    responseModalities: ["TEXT"],
                },
            },
        };

        // Suppress verbose setup debug logging
        this.sendMessage(setupMessage);
    }

    // Utterance diagnostics helpers
    markUtteranceStart() {
        this._utteranceCounters = {
            audioChunks: 0,
            videoFrames: 0,
            firstAudioAt: null,
            firstVideoAt: null,
        };
        // Suppress utteranceStart debug log

        // Reset per-turn stats and increment sequence for summary
        this._turnSeq += 1;
        this._turnStats = {
            audioChunks: 0,
            audioBytes: 0,
            screens: 0,
            screenBytes: 0,
            userText: "",
        };
    }

    logUtteranceEnd(elapsedMs) {
        // Suppress utteranceEnd debug log
    }

    // Deprecated: text chunks over realtimeInput are not used anymore
    sendTextChunk(_) {}

    // One-time conversation history after setupComplete
    sendConversationHistory(contents) {
        if (!Array.isArray(contents) || contents.length === 0) return;
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        // Batch all turns into a single clientContent message
        const safeTurns = contents
            .filter((t) => t && t.role && t.parts)
            .map((t) => ({
                // Live WS expects assistant turns labeled as "assistant" (not "model")
                role: t.role === "model" ? "assistant" : t.role,
                parts: t.parts,
            }));
        if (safeTurns.length > 0) {
            const message = { clientContent: { turns: safeTurns } };
            // Avoid capturing these user turns as the current utterance input
            this._suppressUserCapture = true;
            this.sendMessage(message);
            this._suppressUserCapture = false;
            // Log canonical history derived from the exact payload we sent
            try {
                // Build paired turns from the exact payload
                const turnsRaw = [];
                let pendingUser = null;
                safeTurns.forEach((m) => {
                    const role = m.role;
                    const text = (m?.parts?.[0]?.text || "").trim();
                    if (role === "user") {
                        if (pendingUser !== null) {
                            turnsRaw.push({
                                user: pendingUser,
                                assistant: null,
                            });
                        }
                        pendingUser = text;
                    } else if (role === "assistant") {
                        if (pendingUser !== null) {
                            turnsRaw.push({
                                user: pendingUser,
                                assistant: text,
                            });
                            pendingUser = null;
                        } else if (
                            turnsRaw.length > 0 &&
                            turnsRaw[turnsRaw.length - 1].assistant == null
                        ) {
                            turnsRaw[turnsRaw.length - 1].assistant = text;
                        } else {
                            turnsRaw.push({ user: "", assistant: text });
                        }
                    }
                });
                if (pendingUser !== null)
                    turnsRaw.push({ user: pendingUser, assistant: null });

                // Normalize + dedupe consecutive identical pairs for logging only
                const norm = (s) => (s || "").trim();
                const turns = [];
                for (const t of turnsRaw) {
                    const last = turns[turns.length - 1];
                    const same =
                        last &&
                        norm(last.user) === norm(t.user) &&
                        norm(last.assistant || "") === norm(t.assistant || "");
                    if (!same) turns.push(t);
                }
                this.#logCanonicalHistory(turns);
            } catch (_) {}
        }
    }

    // Per-turn finalized user message only
    sendUserMessage(text) {
        const trimmed = typeof text === "string" ? text.trim() : "";
        if (!trimmed) return;
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        try {
            console.debug(
                `[RealtimeClient] sendUserMessage len=${trimmed.length}`
            );
        } catch (_) {}
        const message = {
            clientContent: {
                turns: [
                    {
                        role: "user",
                        parts: [{ text: trimmed }],
                    },
                ],
            },
        };
        this.sendMessage(message);
    }

    sendAudioChunk(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            this.pendingAudioChunks.push(base64Data);
            return;
        }

        // Log audio chunk for streaming statistics
        streamingLogger.logAudioChunk(base64Data.length);

        // Aggregate per-turn audio stats
        try {
            const bytes = this.#estimateBase64Bytes(base64Data);
            this._turnStats.audioChunks += 1;
            this._turnStats.audioBytes += bytes;
        } catch (_) {}

        // Utterance diagnostics: first-chunk and counter
        try {
            if (this._utteranceCounters.audioChunks === 0) {
                this._utteranceCounters.firstAudioAt = Date.now();
            }
            this._utteranceCounters.audioChunks += 1;
        } catch (_) {}

        const message = {
            realtimeInput: {
                audio: {
                    data: base64Data,
                    mimeType: "audio/pcm;rate=16000",
                },
            },
        };
        this.sendMessage(message);
    }

    sendVideoFrame(base64Data) {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            // Drop frame when not ready; do not buffer to avoid stale sends
            streamingLogger.logInfo("DROP video frame (setup not ready)");
            return;
        }

        // Log video frame for streaming statistics
        streamingLogger.logVideoFrame(base64Data.length);

        // Aggregate per-turn video stats
        try {
            const bytes = this.#estimateBase64Bytes(base64Data);
            this._turnStats.screens += 1;
            this._turnStats.screenBytes += bytes;
        } catch (_) {}

        // Utterance diagnostics: first-frame and counter
        try {
            if (this._utteranceCounters.videoFrames === 0) {
                this._utteranceCounters.firstVideoAt = Date.now();
            }
            this._utteranceCounters.videoFrames += 1;
        } catch (_) {}

        const message = {
            realtimeInput: {
                mediaChunks: [
                    {
                        mimeType: "image/jpeg",
                        data: base64Data,
                    },
                ],
            },
        };
        this.sendMessage(message);
    }

    // Explicit utterance boundary controls
    sendActivityStart() {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        const message = { realtimeInput: { activityStart: {} } };
        try {
            this.ws.send(JSON.stringify(message));
            streamingLogger.logInfo("↗️ Sent activityStart");
        } catch (error) {
            console.error("Failed to send activityStart:", error);
        }
    }

    sendActivityEnd() {
        if (
            !this.isSetupComplete ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        ) {
            return;
        }
        const message = { realtimeInput: { activityEnd: {} } };
        try {
            this.ws.send(JSON.stringify(message));
            streamingLogger.logInfo("↗️ Sent activityEnd");
        } catch (error) {
            console.error("Failed to send activityEnd:", error);
        }
    }

    // Audio input gating
    enableAudioInput() {
        this.audioInputEnabled = true;
        streamingLogger.logInfo("🎤 Audio input ENABLED");
    }

    disableAudioInput() {
        this.audioInputEnabled = false;
        streamingLogger.logInfo("🎤 Audio input DISABLED");
    }

    isAudioInputEnabled() {
        return this.audioInputEnabled === true;
    }

    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                const messageStr = JSON.stringify(message);

                // Pre-send inspection to update aggregates from the exact payload
                try {
                    if (message?.realtimeInput?.audio?.data) {
                        const b64 = message.realtimeInput.audio.data;
                        this._turnStats.audioChunks += 1;
                        this._turnStats.audioBytes +=
                            this.#estimateBase64Bytes(b64);
                    }
                    const media = message?.realtimeInput?.mediaChunks;
                    if (Array.isArray(media)) {
                        for (const chunk of media) {
                            const data = chunk?.data;
                            if (data) {
                                this._turnStats.screens += 1;
                                this._turnStats.screenBytes +=
                                    this.#estimateBase64Bytes(data);
                            }
                        }
                    }
                    const turns = message?.clientContent?.turns;
                    if (Array.isArray(turns) && !this._suppressUserCapture) {
                        for (const t of turns) {
                            if (t?.role === "user") {
                                const txt =
                                    t?.parts
                                        ?.map((p) => p?.text || "")
                                        .join(" | ") || "";
                                this._turnStats.userText = txt;
                            }
                        }
                    }
                } catch (_) {}

                // Send message to Gemini
                this.ws.send(messageStr);
            } catch (error) {
                try {
                    console.error(
                        "Gemini WS failed to send message. readyState=",
                        this.ws?.readyState,
                        error
                    );
                } catch (_) {}
            }
        } else {
            console.warn("Gemini WS not ready. State:", this.ws?.readyState);
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);

            if (
                message.setupComplete !== undefined ||
                message.setup_complete !== undefined
            ) {
                this.isSetupComplete = true;
                this.processBufferedChunks();
                // Suppress SetupComplete debug log
                // Immediately send conversation history as clientContent turns (no media yet)
                (async () => {
                    try {
                        const turns =
                            await ContextAssembler.getCanonicalTurns();
                        // Flatten to WS contents for sending; keep canonical turns for logging
                        const wsContents =
                            ContextAssembler.flattenTurnsToWsContents(turns);
                        this._historySent = turns;
                        // Send payload if any (logging will be handled inside sendConversationHistory)
                        if (wsContents.length) {
                            this.sendConversationHistory(wsContents);
                        } else {
                            try {
                                console.debug(
                                    "%c[RealtimeClient] History | empty",
                                    "color:#6a1b9a;font-weight:bold"
                                );
                            } catch (_) {}
                        }
                    } catch (e) {
                        console.warn("[RealtimeClient] history send failed", e);
                    }
                })();
                return;
            }

            // Check for turn completion flag

            this.responseQueue.push(message);
            this.processResponseQueue();
        } catch (error) {
            console.error("Error parsing Gemini message:", error);
        }
    }

    async processResponseQueue() {
        if (this.isProcessingTurn) {
            return;
        }

        while (this.responseQueue.length > 0) {
            const message = this.responseQueue.shift();
            this.currentTurn.push(message);

            // Extract text from this message chunk
            const chunkText = this.extractTextFromMessage(message);
            if (chunkText) {
                this.currentStreamingResponse += chunkText;
                this.isStreaming = true;

                // Send real-time streaming update to UI (ChatGPT-style)
                if (this.callbacks.onStreamingUpdate) {
                    this.callbacks.onStreamingUpdate({
                        text: this.currentStreamingResponse,
                        isStreaming: true,
                        isComplete: false,
                        timestamp: Date.now(),
                    });
                }
                // Suppress chunk-length per message debug log
            }

            // Only rely on explicit turn completion flag from Gemini
            const isTurnComplete =
                message.serverContent?.turnComplete === true ||
                message.serverContent?.turn_complete === true ||
                message.turnComplete === true ||
                message.turn_complete === true;

            if (isTurnComplete) {
                this.isProcessingTurn = true;
                // Suppress turnComplete debug log
                await this.handleCompleteTurn(this.currentStreamingResponse);
                this.currentTurn = [];
                this.currentStreamingResponse = "";
                this.isStreaming = false;
                this.isProcessingTurn = false;
                break;
            }
        }
    }

    extractTextFromMessage(message) {
        let text = "";

        // Check for different possible response structures
        if (
            message.serverContent &&
            message.serverContent.modelTurn &&
            message.serverContent.modelTurn.parts
        ) {
            message.serverContent.modelTurn.parts.forEach((part) => {
                if (part.text) {
                    text += part.text;
                }
            });
        }

        // Check for direct text in serverContent
        if (message.serverContent && message.serverContent.text) {
            text += message.serverContent.text;
        }

        // Check for direct text in message
        if (message.text) {
            text += message.text;
        }

        // Check for parts array in serverContent
        if (message.serverContent && message.serverContent.parts) {
            message.serverContent.parts.forEach((part) => {
                if (part.text) {
                    text += part.text;
                }
            });
        }

        return text;
    }

    async handleCompleteTurn(finalText) {
        if (finalText && this.callbacks.onBotResponse) {
            this.callbacks.onBotResponse({
                text: finalText,
                isStreaming: false, // Explicitly mark as final response
                timestamp: Date.now(),
            });
        }

        // Emit four-line TurnSummary (more readable)
        try {
            const modality = this._turnStats.audioChunks > 0 ? "voice" : "text";
            const channel = "WS";
            const uttNum = this._sessionUtterances.length + 1; // current utterance index (previous-only buffer)
            const userPreview = JSON.stringify(
                (this._turnStats.userText || "").slice(0, 120)
            );
            const outputPreview = JSON.stringify(
                (finalText || "").slice(0, 120)
            );
            const audioSize = streamingLogger.formatBytes(
                this._turnStats.audioBytes
            );
            const screenSize = streamingLogger.formatBytes(
                this._turnStats.screenBytes
            );

            // Styled, user-friendly block: header uses Session/Turn, colored lines
            const sHdr = "color:#6a1b9a;font-weight:bold"; // purple
            const sLbl = "color:#00838f;font-weight:bold"; // teal
            const sUser = "color:#1e88e5;font-weight:bold"; // blue
            const sAsst = "color:#2e7d32;font-weight:bold"; // green
            console.debug(
                `%c[RealtimeClient] Session ${this._connectSeq} Turn ${this._turnSeq}`,
                sHdr
            );
            console.debug(
                `%cSummary:%c [${channel} | ${modality} | audio=${this._turnStats.audioChunks} chunks (${audioSize}) | screens=${this._turnStats.screens} frames (${screenSize})]`,
                sLbl,
                ""
            );
            console.debug(`%cUser:%c ${userPreview}`, sUser, "");
            console.debug(`%cOutput:%c ${outputPreview}`, sAsst, "");
        } catch (_) {}

        // Append current utterance AFTER logging so previous-only semantics hold
        try {
            const user = this._turnStats.userText || "";
            const assistant = finalText || "";
            if (user || assistant) {
                this._sessionUtterances.push({
                    user,
                    assistant,
                    ts: Date.now(),
                });
            }
        } catch (_) {}
    }

    // Private helpers
    #estimateBase64Bytes(b64) {
        if (!b64) return 0;
        const len = b64.length;
        const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
        return Math.floor((len * 3) / 4) - padding;
    }

    // Pretty multi-line, colorized canonical history output (first and last turns)
    #logCanonicalHistory(turns) {
        const pairs = Array.isArray(turns) ? turns : [];
        if (pairs.length === 0) {
            console.debug("[RealtimeClient] History | empty");
            return;
        }
        const sHdr = "color:#6a1b9a;font-weight:bold"; // purple
        const sUser = "color:#1e88e5;font-weight:bold"; // blue
        const sAsst = "color:#2e7d32;font-weight:bold"; // green
        console.debug(
            `%c[RealtimeClient] History | total turns=${pairs.length}`,
            sHdr
        );
        const first = pairs[0];
        console.debug(
            `%cTurn 1 — User:%c ${JSON.stringify(
                (first.user || "").slice(0, 60)
            )}`,
            sUser,
            ""
        );
        console.debug(
            `%cTurn 1 — Assistant:%c ${
                first.assistant == null
                    ? "(pending)"
                    : JSON.stringify((first.assistant || "").slice(0, 60))
            }`,
            sAsst,
            ""
        );
        if (pairs.length > 1) {
            const last = pairs[pairs.length - 1];
            console.debug("…");
            console.debug(
                `%cTurn ${pairs.length} — User:%c ${JSON.stringify(
                    (last.user || "").slice(0, 60)
                )}`,
                sUser,
                ""
            );
            console.debug(
                `%cTurn ${pairs.length} — Assistant:%c ${
                    last.assistant == null
                        ? "(pending)"
                        : JSON.stringify((last.assistant || "").slice(0, 60))
                }`,
                sAsst,
                ""
            );
        }
    }

    #formatHistoryLineForLog() {
        const snap = Array.isArray(this._historySent) ? this._historySent : [];
        if (snap.length === 0) return "[RealtimeClient] History | empty";

        // Build paired turns: user -> assistant (model treated as assistant)
        const pairs = [];
        let currentUser = null;
        for (const m of snap) {
            const role = m.role === "model" ? "assistant" : m.role;
            const text = (m?.parts?.[0]?.text || "").trim();
            if (role === "user") {
                // Start a new turn; if previous user was unpaired, push it as in-progress
                if (currentUser !== null) {
                    pairs.push({ user: currentUser, assistant: null });
                }
                currentUser = text;
            } else if (role === "assistant") {
                if (currentUser !== null) {
                    pairs.push({ user: currentUser, assistant: text });
                    currentUser = null;
                } else {
                    // Assistant with no leading user; attach to previous if exists
                    if (
                        pairs.length > 0 &&
                        pairs[pairs.length - 1].assistant == null
                    ) {
                        pairs[pairs.length - 1].assistant = text;
                    } else {
                        // Edge: stray assistant, treat as its own turn with empty user
                        pairs.push({ user: "", assistant: text });
                    }
                }
            }
        }
        // Trailing in-progress user
        if (currentUser !== null) {
            pairs.push({ user: currentUser, assistant: null });
        }

        const turnsCount = pairs.length;
        if (turnsCount === 0) return "[RealtimeClient] History | empty";

        const first = pairs[0];
        const last = pairs[turnsCount - 1];
        const firstUser = JSON.stringify((first.user || "").slice(0, 60));
        const firstAssistant =
            first.assistant == null
                ? "(pending)"
                : JSON.stringify((first.assistant || "").slice(0, 60));
        const lastUser =
            turnsCount > 1
                ? JSON.stringify((last.user || "").slice(0, 60))
                : null;
        const lastAssistant =
            turnsCount > 1
                ? last.assistant == null
                    ? "(pending)"
                    : JSON.stringify((last.assistant || "").slice(0, 60))
                : null;

        if (turnsCount === 1) {
            return `[RealtimeClient] History | turns=1 | first: user=${firstUser} assistant=${firstAssistant}`;
        }
        return `[RealtimeClient] History | turns=${turnsCount} | first: user=${firstUser} assistant=${firstAssistant} | ... | last: user=${lastUser} assistant=${lastAssistant}`;
    }

    processBufferedChunks() {
        const audioChunks = [...this.pendingAudioChunks];
        this.pendingAudioChunks = [];
        audioChunks.forEach((base64Data) => {
            this.sendAudioChunk(base64Data);
        });

        // Optional safety: do NOT flush stale video frames on setup complete
        // Clear any queued frames to ensure only current-tab frames are sent
        if (this.pendingVideoFrames.length > 0) {
            streamingLogger.logInfo(
                `DROP ${this.pendingVideoFrames.length} queued video frames on setupComplete`
            );
        }
        this.pendingVideoFrames = [];
    }

    startKeepAlive() {
        this.stopKeepAlive();

        this.keepAliveTimer = setInterval(() => {
            if (
                this.ws &&
                this.ws.readyState === WebSocket.OPEN &&
                !this.isManualStop
            ) {
                const keepAliveMessage = {
                    realtimeInput: {
                        mediaChunks: [],
                    },
                };

                try {
                    this.ws.send(JSON.stringify(keepAliveMessage));
                } catch (error) {
                    console.error("Gemini WS keep-alive failed:", error);
                }
            }
        }, 30000);
    }

    stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    scheduleReconnection() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        const delay = Math.min(
            Math.pow(2, this.reconnectAttempts) * 1000,
            30000
        );
        this.reconnectAttempts++;

        try {
            console.warn(
                `Gemini WS scheduleReconnection attempt=${this.reconnectAttempts} delayMs=${delay}`
            );
        } catch (_) {}

        this.reconnectTimer = setTimeout(async () => {
            if (!this.isManualStop) {
                try {
                    await this.connect();
                } catch (error) {
                    console.error("Gemini WS reconnection failed:", error);
                }
            }
        }, delay);
    }

    clearBuffers() {
        this.pendingAudioChunks = [];
        this.pendingVideoFrames = [];
        this.responseQueue = [];
        this.currentTurn = [];
        this.isProcessingTurn = false;
        this.currentStreamingResponse = "";
        this.isStreaming = false;
    }

    clearPendingVideoFrames() {
        this.pendingVideoFrames = [];
    }

    async disconnect() {
        this.isManualStop = true;

        this.stopKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            try {
                // Before closing, persist utterances if any (once)
                if (!this._hasPersistedUtterances) {
                    this._hasPersistedUtterances = true;
                    await this.#persistSessionUtterances();
                }
            } catch (_) {}
            this.ws.close();
            this.ws = null;
        }

        if (this.audioContext && this.audioContext.state === "running") {
            await this.audioContext.suspend();
        }

        this.isConnected = false;
        this.isSetupComplete = false;
        this.clearBuffers();

        // Stop streaming logger
        streamingLogger.stop();
    }

    async #persistSessionUtterances() {
        try {
            if (
                !this._sessionUtterances ||
                this._sessionUtterances.length === 0
            ) {
                return;
            }
            const { UnifiedConversationManager } = await import(
                "../utils/storage.js"
            );
            for (const u of this._sessionUtterances) {
                if (u.user) {
                    await UnifiedConversationManager.saveMessage(
                        u.user,
                        "user",
                        u.ts
                    );
                }
                if (u.assistant) {
                    await UnifiedConversationManager.saveMessage(
                        u.assistant,
                        "assistant",
                        u.ts
                    );
                }
            }
            this._sessionUtterances = [];
        } catch (err) {
            console.error("Failed to persist session utterances:", err);
        }
    }

    setBotResponseCallback(callback) {
        this.callbacks.onBotResponse = callback;
    }

    setConnectionStateCallback(callback) {
        this.callbacks.onConnectionStateChange = callback;
    }

    setErrorCallback(callback) {
        this.callbacks.onError = callback;
    }

    setStreamingUpdateCallback(callback) {
        this.callbacks.onStreamingUpdate = callback;
    }

    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            isSetupComplete: this.isSetupComplete,
        };
    }
}
