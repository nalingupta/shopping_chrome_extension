import { LivePreviewManager } from "../live-preview-manager.js";

// Thin adapter around LivePreviewManager to decouple VideoHandler
export class PreviewAdapter {
    constructor() {
        this.manager = new LivePreviewManager();
    }

    setFps(fps) {
        this.manager.setFps?.(fps);
    }

    startPreview() {
        this.manager.startPreview?.();
    }

    updatePreview(frameBase64) {
        this.manager.updatePreview?.(frameBase64);
    }

    stopPreview() {
        this.manager.stopPreview?.();
    }
}
