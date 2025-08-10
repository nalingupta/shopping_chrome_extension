// Content scripts cannot use static ESM imports reliably across all pages.
// Use dynamic import with chrome.runtime.getURL to load modules as needed.
let MESSAGE_TYPES;
let PageAnalyzer;

(async () => {
    try {
        const mod1 = await import(
            chrome.runtime.getURL("src/utils/constants.js")
        );
        MESSAGE_TYPES = mod1.MESSAGE_TYPES;
    } catch (e) {
        console.warn("[Content] failed to load constants.js", e);
    }
    try {
        const mod2 = await import(
            chrome.runtime.getURL("src/services/page-analyzer.js")
        );
        PageAnalyzer = mod2.PageAnalyzer;
    } catch (e) {
        console.warn("[Content] failed to load page-analyzer.js", e);
        // Minimal fallback if module load fails
        PageAnalyzer = class {
            static getCompletePageInfo() {
                return {
                    url: window.location.href,
                    domain: window.location.hostname,
                    title: document.title,
                    timestamp: Date.now(),
                };
            }
        };
    }
    // Initialize the content script after modules are loaded
    new ContentScript();
})();

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
            }
        );
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
}

class ContentScript {
    constructor() {
        this.currentUrl = window.location.href;
        this.currentDomain = window.location.hostname;
        this.micPermissionHandler = new MicPermissionHandler();

        this.initialize();
    }

    initialize() {
        this.sendPageInfoToSidebar();
        this.setupEventListeners();
        this.observeUrlChanges();
    }

    sendPageInfoToSidebar() {
        const pageInfo = PageAnalyzer.getCompletePageInfo();

        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.PAGE_INFO_UPDATE,
            data: pageInfo,
        });
    }

    setupEventListeners() {
        window.addEventListener("load", () => {
            this.sendPageInfoToSidebar();
        });

        chrome.runtime.onMessage.addListener(
            (request, sender, sendResponse) => {
                if (request.type === MESSAGE_TYPES.GET_PAGE_INFO) {
                    const pageInfo = PageAnalyzer.getCompletePageInfo();
                    sendResponse(pageInfo);
                }

                if (request.type === MESSAGE_TYPES.REQUEST_MIC_PERMISSION) {
                    this.handleMicrophoneRequest(sendResponse);
                    return true;
                }
            }
        );
    }

    observeUrlChanges() {
        let lastUrl = this.currentUrl;

        const observer = new MutationObserver(() => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                this.currentUrl = lastUrl;
                this.currentDomain = window.location.hostname;

                setTimeout(() => {
                    this.sendPageInfoToSidebar();
                }, 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
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

// Note: actual initialization happens after dynamic imports above
