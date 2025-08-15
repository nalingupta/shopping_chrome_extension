// Local minimal constants to avoid importing extension files at runtime
// (dynamic imports of extension resources from content scripts require
// web_accessible_resources, so we keep it self-contained)
let MESSAGE_TYPES = {
    REQUEST_MIC_PERMISSION: "REQUEST_MIC_PERMISSION",
    MIC_PERMISSION_RESULT: "MIC_PERMISSION_RESULT",
    AUDIO_RECORDED: "AUDIO_RECORDED",
    SESSION_MODE_CHANGED: "SESSION_MODE_CHANGED",
    REQUEST_TAB_INFO: "REQUEST_TAB_INFO",
};

class MicPermissionHandler {
    constructor() {
        this.permissionGranted = false;
        this.initializeMessageListener();
    }

    initializeMessageListener() {
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (request.type === MESSAGE_TYPES.REQUEST_MIC_PERMISSION) {
                    this.requestMicPermission().then(sendResponse);
                    return true;
                }

                if (request.type === "CHECK_MIC_PERMISSION") {
                    sendResponse({ granted: this.permissionGranted });
                    return false;
                }

                if (request.type === MESSAGE_TYPES.SESSION_MODE_CHANGED) {
                    try {
                        this.handleSessionModeChanged?.(request.mode);
                    } catch (_) {}
                    return false;
                }
            }
        );

        // Storage-based listener for session mode changes
        try {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === "local" && changes.sessionMode) {
                    try {
                        this.handleSessionModeChanged?.(changes.sessionMode.newValue);
                    } catch (_) {}
                }
            });
        } catch (_) {}
    }

    async requestMicPermission() {
        try {
            if (this.permissionGranted) {
                return { success: true, alreadyGranted: true };
            }

            return this.waitForPermissionResult();
        } catch (error) {
            return {
                success: false,
                error: "failed",
                details: error.message,
            };
        }
    }

    waitForPermissionResult() {
        return new Promise((resolve) => {
            const messageHandler = (event) => {
                if (event.origin !== chrome.runtime.getURL("").slice(0, -1)) {
                    return;
                }

                if (event.data.type === MESSAGE_TYPES.MIC_PERMISSION_RESULT) {
                    this.cleanupPermissionRequest(messageHandler);
                    this.permissionGranted = event.data.granted;

                    resolve({
                        success: event.data.granted,
                        error: event.data.error,
                        details: event.data.details,
                    });
                }
            };

            window.addEventListener("message", messageHandler);

            setTimeout(() => {
                this.cleanupPermissionRequest(messageHandler);
                resolve({
                    success: false,
                    error: "timeout",
                    details: "Permission request timed out",
                });
            }, 10000);
        });
    }

    cleanupPermissionRequest(messageHandler) {
        window.removeEventListener("message", messageHandler);
    }

    // Optional hook: pages can observe mode changes by monkey-patching
    // contentScript.micPermissionHandler.handleSessionModeChanged = (mode) => { ... }
    handleSessionModeChanged(_mode) {}
}

class ContentScript {
    constructor() {
        this.currentUrl = window.location.href;
        this.currentDomain = window.location.hostname;
        this.micPermissionHandler = new MicPermissionHandler();

        this.initialize();
    }

    initialize() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (request.type === MESSAGE_TYPES.REQUEST_MIC_PERMISSION) {
                    this.handleMicrophoneRequest(sendResponse);
                    return true;
                }

                if (request.type === MESSAGE_TYPES.REQUEST_TAB_INFO) {
                    try {
                        const info = this.collectTabInfo();
                        sendResponse({ success: true, info, captureTsAbsMs: Date.now() });
                    } catch (error) {
                        sendResponse({ success: false, error: String(error?.message || error) });
                    }
                    return true;
                }
            }
        );
    }

    collectTabInfo() {
        try {
            const title = String(document?.title || "");
            const url = String(location?.href || "");
            const meta = (name) => {
                try {
                    const el = document.querySelector(`meta[name="${name}"]`);
                    return el ? String(el.getAttribute("content") || "") : "";
                } catch (_) { return ""; }
            };
            return {
                title,
                url,
                description: meta("description"),
                keywords: meta("keywords"),
            };
        } catch (_) {
            return { title: "", url: "", description: "", keywords: "" };
        }
    }

    async handleMicrophoneRequest(sendResponse) {
        try {
            if (!window.isSecureContext) {
                sendResponse({
                    success: false,
                    error: "not_secure_context",
                    details:
                        "Microphone access requires a secure context (HTTPS)",
                });
                return;
            }

            if (
                !navigator.mediaDevices ||
                !navigator.mediaDevices.getUserMedia
            ) {
                sendResponse({
                    success: false,
                    error: "getusermedia_not_supported",
                    details: "getUserMedia API not supported in this context",
                });
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100,
                },
            });

            const mimeType = MediaRecorder.isTypeSupported("audio/webm")
                ? "audio/webm"
                : "audio/ogg";

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            const audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                const audioUrl = URL.createObjectURL(audioBlob);

                chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.AUDIO_RECORDED,
                    data: {
                        audioUrl: audioUrl,
                        blob: audioBlob,
                    },
                });

                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorder.start();

            sendResponse({
                success: true,
                mediaRecorder: mediaRecorder,
                stream: stream,
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: this.getErrorType(error),
                details: error.message,
            });
        }
    }

    getErrorType(error) {
        if (error.name === "NotAllowedError") {
            return "permission_denied";
        } else if (error.name === "NotFoundError") {
            return "no_microphone";
        } else if (error.name === "NotReadableError") {
            return "microphone_in_use";
        } else if (error.name === "OverconstrainedError") {
            return "constraints_not_satisfied";
        } else {
            return "unknown_error";
        }
    }
}

// Initialize the content script when it loads
new ContentScript();
