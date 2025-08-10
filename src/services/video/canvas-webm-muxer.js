export class CanvasWebmMuxer {
    constructor() {
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d", { desynchronized: true });
        this.videoStream = null;
        this.audioStream = null;
        this.combinedStream = null;
        this.mediaRecorder = null;
        this.mimeType = "video/webm;codecs=vp8,opus";
        this.bitsPerSecond = 1_000_000;
        this.seq = 0;
        this.onChunk = null;
        this.isActive = false;
        // Track whether at least one real frame has been drawn to the canvas
        this.hasDrawnOnce = false;
    }

    init(width = 1280, height = 720, bitsPerSecond = 1_000_000) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.bitsPerSecond = bitsPerSecond;
        this.videoStream = this.canvas.captureStream();
        return { success: true };
    }

    attachAudioTrack(streamOrDestinationNode) {
        if (!streamOrDestinationNode)
            return { success: false, error: "No audio source provided" };

        if (
            typeof MediaStream !== "undefined" &&
            streamOrDestinationNode instanceof MediaStream
        ) {
            this.audioStream = streamOrDestinationNode;
        } else if (
            streamOrDestinationNode &&
            streamOrDestinationNode.stream instanceof MediaStream
        ) {
            // MediaStreamAudioDestinationNode
            this.audioStream = streamOrDestinationNode.stream;
        } else {
            return { success: false, error: "Unsupported audio source type" };
        }

        return { success: true };
    }

    start(timesliceMs = 200, onChunk) {
        if (!this.videoStream) {
            this.init();
        }
        this.onChunk = onChunk;

        this.combinedStream = new MediaStream();
        for (const track of this.videoStream.getVideoTracks())
            this.combinedStream.addTrack(track);
        if (this.audioStream) {
            for (const track of this.audioStream.getAudioTracks())
                this.combinedStream.addTrack(track);
        }

        const options = {};
        // Prefer explicit bitsPerSecond where supported
        options.mimeType = this.mimeType;
        options.bitsPerSecond = this.bitsPerSecond;

        this.mediaRecorder = new MediaRecorder(this.combinedStream, options);
        this.mediaRecorder.ondataavailable = (e) => {
            // Drop tiny/empty initial slices which can be produced on the first tick
            if (!e.data || e.data.size === 0) return;
            if (!this.hasDrawnOnce) return;
            if (e.data.size < 1024) return;
            const header = {
                seq: this.seq++,
                ts: Date.now(),
                mime: this.mediaRecorder.mimeType || this.mimeType,
                durMs: timesliceMs,
            };
            if (typeof this.onChunk === "function") {
                this.onChunk(e.data, header);
            }
        };
        this.mediaRecorder.start(timesliceMs);
        this.isActive = true;
        return { success: true };
    }

    stop() {
        try {
            if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
                this.mediaRecorder.stop();
            }
        } catch (_) {}
        this.isActive = false;
        return { success: true };
    }

    async pushFrame(base64Jpeg, ts = Date.now()) {
        if (!this.isActive) return;
        try {
            const blob = this.#base64JpegToBlob(base64Jpeg);
            const bitmap = await createImageBitmap(blob);
            this.ctx.drawImage(
                bitmap,
                0,
                0,
                this.canvas.width,
                this.canvas.height
            );
            this.hasDrawnOnce = true;
        } catch (err) {
            // Swallow frame decode errors to avoid disrupting stream
        }
    }

    #base64JpegToBlob(base64) {
        // Accept raw base64 or data URL
        const commaIdx = base64.indexOf(",");
        const b64 = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;
        const byteChars = atob(b64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: "image/jpeg" });
    }
}
