export class LivePreviewManager {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.panel = null;
        this.placeholder = null;
        this.isActive = false;
        this.frameCount = 0;
        this.lastFrameTime = 0;
        this.fps = 2; // 2 FPS for preview to align with sending rate
        this.frameInterval = 1000 / this.fps;

        this.initialize();
    }

    initialize() {
        this.canvas = document.getElementById("previewCanvas");
        this.panel = document.getElementById("livePreviewPanel");
        this.placeholder = this.panel?.querySelector(".preview-placeholder");

        if (this.canvas) {
            this.ctx = this.canvas.getContext("2d");
            this.setupCanvas();
        }
    }

    setupCanvas() {
        if (!this.canvas || !this.ctx) return;

        // Set canvas size to match panel size
        const rect = this.panel.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        // Set canvas display size
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
    }

    startPreview() {
        if (this.isActive) return;

        this.isActive = true;
        this.frameCount = 0;
        this.lastFrameTime = Date.now();

        if (this.panel) {
            this.panel.classList.add("active");
        }

        if (this.placeholder) {
            this.placeholder.style.display = "none";
        }

        if (this.canvas) {
            this.canvas.classList.remove("hidden");
        }
    }

    stopPreview() {
        if (!this.isActive) return;

        this.isActive = false;

        if (this.panel) {
            this.panel.classList.remove("active");
        }

        if (this.placeholder) {
            this.placeholder.style.display = "flex";
        }

        if (this.canvas) {
            this.canvas.classList.add("hidden");
        }

        // Clear canvas
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    updatePreview(frameData) {
        if (!this.isActive || !this.canvas || !this.ctx) return;

        const currentTime = Date.now();

        // Throttle to 2 FPS
        if (currentTime - this.lastFrameTime < this.frameInterval) {
            return;
        }

        this.lastFrameTime = currentTime;
        this.frameCount++;

        try {
            // Create image from base64 data
            const img = new Image();
            img.onload = () => {
                if (!this.isActive) return;

                // Clear canvas
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

                // Calculate aspect ratio to fit image properly
                const canvasAspect = this.canvas.width / this.canvas.height;
                const imageAspect = img.width / img.height;

                let drawWidth, drawHeight, offsetX, offsetY;

                if (imageAspect > canvasAspect) {
                    // Image is wider than canvas
                    drawWidth = this.canvas.width;
                    drawHeight = this.canvas.width / imageAspect;
                    offsetX = 0;
                    offsetY = (this.canvas.height - drawHeight) / 2;
                } else {
                    // Image is taller than canvas
                    drawHeight = this.canvas.height;
                    drawWidth = this.canvas.height * imageAspect;
                    offsetX = (this.canvas.width - drawWidth) / 2;
                    offsetY = 0;
                }

                // Draw image with proper scaling
                this.ctx.drawImage(
                    img,
                    offsetX,
                    offsetY,
                    drawWidth,
                    drawHeight
                );

                // Add a subtle overlay to show it's live
                this.drawLiveIndicator();
            };
            img.onerror = (error) => {
                console.error("Failed to load preview image:", error);
            };

            // Set source from base64 data
            img.src = `data:image/jpeg;base64,${frameData}`;
        } catch (error) {
            console.error("Error updating preview:", error);
        }
    }

    drawLiveIndicator() {
        if (!this.ctx) return;

        // Draw a small "LIVE" indicator in the corner
        const indicatorSize = 20;
        const padding = 4;

        // Background
        this.ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
        this.ctx.fillRect(padding, padding, indicatorSize, 12);

        // Text
        this.ctx.fillStyle = "white";
        this.ctx.font = "8px -apple-system, BlinkMacSystemFont, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText("LIVE", padding + indicatorSize / 2, padding + 6);
    }

    resize() {
        this.setupCanvas();
    }

    getStatus() {
        return {
            isActive: this.isActive,
            frameCount: this.frameCount,
            fps: this.fps,
        };
    }
}
