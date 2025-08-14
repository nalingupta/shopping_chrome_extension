/**
 * Compact streaming logger for media and audio data
 * Provides a cleaner way to display streaming status without console spam
 */
import { DEBUG_MEDIA } from "../config/debug.js";
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

        this.isActive = true;
        this.audioStats = { chunksSent: 0, lastSent: 0, totalBytes: 0 };
        this.videoStats = { framesSent: 0, lastSent: 0, totalBytes: 0 };

        // Log status every 5 seconds instead of every chunk/frame
        this.statusInterval = setInterval(() => {
            this.logStatus();
        }, 5000);
    }

    stop() {
        if (!this.isActive) return;

        this.isActive = false;
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }

        this.logStatus();
    }

    logAudioChunk(bytes) {
        this.audioStats.chunksSent++;
        this.audioStats.lastSent = Date.now();
        this.audioStats.totalBytes += bytes;
    }

    logVideoFrame(bytes) {
        this.videoStats.framesSent++;
        this.videoStats.lastSent = Date.now();
        this.videoStats.totalBytes += bytes;
    }

    logStatus() {
        const now = Date.now();
        const audioActive = now - this.audioStats.lastSent < 10000; // 10s threshold
        const videoActive = now - this.videoStats.lastSent < 10000; // 10s threshold

        // Always show both streams clearly, even if inactive
        const audioStatus = audioActive
            ? `🎤 AUDIO: ${
                  this.audioStats.chunksSent > 0
                      ? Math.round(this.audioStats.chunksSent / 5)
                      : 0
              }/s (${this.formatBytes(this.audioStats.totalBytes)})`
            : "🎤 AUDIO: inactive";

        const videoStatus = videoActive
            ? `📹 VIDEO: ${
                  this.videoStats.framesSent > 0
                      ? Math.round(this.videoStats.framesSent / 5)
                      : 0
              }/s (${this.formatBytes(this.videoStats.totalBytes)})`
            : "📹 VIDEO: inactive";

        // Suppressed periodic stream status logs to reduce console noise
        // If explicitly enabled, emit a concise status line.
        if (DEBUG_MEDIA) {
            try {
                const a = audioStatus;
                const v = videoStatus;
                // eslint-disable-next-line no-console
                console.log(`[Media] ${a} | ${v}`);
            } catch (_) {}
        }

        // Reset counters for next interval
        this.audioStats.chunksSent = 0;
        this.videoStats.framesSent = 0;
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
        if (DEBUG_MEDIA) {
            try {
                // eslint-disable-next-line no-console
                console.log(String(message || ""));
            } catch (_) {}
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

        if (!DEBUG_MEDIA) return;
        try {
            // eslint-disable-next-line no-console
            console.log("🔍 STREAM DETAILS:");
            // eslint-disable-next-line no-console
            console.log(
                `   🎤 Audio Stream: ${audioActive ? "ACTIVE" : "INACTIVE"}`
            );
            // eslint-disable-next-line no-console
            console.log(`      - Chunks sent: ${this.audioStats.chunksSent}`);
            // eslint-disable-next-line no-console
            console.log(
                `      - Total data: ${this.formatBytes(
                    this.audioStats.totalBytes
                )}`
            );
            // eslint-disable-next-line no-console
            console.log(
                `      - Last activity: ${audioActive ? "Recent" : "None"}`
            );

            // eslint-disable-next-line no-console
            console.log(
                `   📹 Video Stream: ${videoActive ? "ACTIVE" : "INACTIVE"}`
            );
            // eslint-disable-next-line no-console
            console.log(`      - Frames sent: ${this.videoStats.framesSent}`);
            // eslint-disable-next-line no-console
            console.log(
                `      - Total data: ${this.formatBytes(
                    this.videoStats.totalBytes
                )}`
            );
            // eslint-disable-next-line no-console
            console.log(
                `      - Last activity: ${videoActive ? "Recent" : "None"}`
            );
        } catch (_) {}
    }
}

// Global instance
export const streamingLogger = new StreamingLogger();
