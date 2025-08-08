/**
 * Compact streaming logger for media and audio data
 * Provides a cleaner way to display streaming status without console spam
 */
export class StreamingLogger {
    constructor() {
        this.audioStats = {
            chunksSent: 0,
            lastSent: 0,
            totalBytes: 0,
        };
        this.videoStats = {
            framesSent: 0,
            lastSent: 0,
            totalBytes: 0,
        };
        this.statusInterval = null;
        this.isActive = false;
    }

    start() {
        if (this.isActive) return;
        // Keep state but do not output periodic matrix logs
        this.isActive = true;
        this.audioStats = { chunksSent: 0, lastSent: 0, totalBytes: 0 };
        this.videoStats = { framesSent: 0, lastSent: 0, totalBytes: 0 };
    }

    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    logAudioChunk(bytes) {
        // No-op: suppress matrix logs
        this.audioStats.chunksSent++;
        this.audioStats.lastSent = Date.now();
        this.audioStats.totalBytes += bytes;
    }

    logVideoFrame(bytes) {
        // No-op: suppress matrix logs
        this.videoStats.framesSent++;
        this.videoStats.lastSent = Date.now();
        this.videoStats.totalBytes += bytes;
    }

    logStatus() {
        // No-op: remove periodic matrix logging
    }

    formatBytes(bytes) {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    logError(type, error) {
        console.error(`❌ ${type} error:`, error?.message || error);
    }

    logInfo(message) {
        console.log(`ℹ️ ${message}`);
    }

    // Simple metric logger for numeric values
    logMetric(name, value) {
        // Only output latency metric in milliseconds
        if (name === "deepgram_latency_ms") {
            try {
                console.log(`${value}`);
            } catch (_) {
                // no-op
            }
        }
    }

    // Manual trigger for testing
    forceStatusUpdate() {
        this.logStatus();
    }

    // Show detailed stream information
    showStreamDetails() {
        const now = Date.now();
        const audioActive = now - this.audioStats.lastSent < 10000;
        const videoActive = now - this.videoStats.lastSent < 10000;

        console.log("🔍 STREAM DETAILS:");
        console.log(
            `   🎤 Audio Stream: ${audioActive ? "ACTIVE" : "INACTIVE"}`
        );
        console.log(`      - Chunks sent: ${this.audioStats.chunksSent}`);
        console.log(
            `      - Total data: ${this.formatBytes(
                this.audioStats.totalBytes
            )}`
        );
        console.log(
            `      - Last activity: ${audioActive ? "Recent" : "None"}`
        );

        console.log(
            `   📹 Video Stream: ${videoActive ? "ACTIVE" : "INACTIVE"}`
        );
        console.log(`      - Frames sent: ${this.videoStats.framesSent}`);
        console.log(
            `      - Total data: ${this.formatBytes(
                this.videoStats.totalBytes
            )}`
        );
        console.log(
            `      - Last activity: ${videoActive ? "Recent" : "None"}`
        );
    }
}

// Global instance
export const streamingLogger = new StreamingLogger();
