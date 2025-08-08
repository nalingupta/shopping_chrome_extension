// BubbleLayoutManager: computes and sets a constant pixel width for message bubbles
// so layout is deterministic from the first frame (prevents vertical stacking and width growth).

export class BubbleLayoutManager {
    constructor() {
        this.messagesContainer = null;
        this.resizeHandler = null;
    }

    initialize(messagesContainer) {
        this.messagesContainer = messagesContainer;
        this.updateBubbleWidth();
        this.attachResizeListener();
    }

    attachResizeListener() {
        if (this.resizeHandler) return;
        this.resizeHandler = () => this.updateBubbleWidth();
        window.addEventListener("resize", this.resizeHandler);
    }

    detach() {
        if (this.resizeHandler) {
            window.removeEventListener("resize", this.resizeHandler);
            this.resizeHandler = null;
        }
    }

    updateBubbleWidth() {
        const root = document.documentElement;
        const container = this.messagesContainer || document.body;

        // Compute available width; fallback if container not measured yet
        const containerWidth =
            container?.clientWidth || window.innerWidth || 800;

        // Reserve gutter for padding/scrollbar. Clamp width for readability.
        const gutter = 64; // px
        const minWidth = 320; // px
        const maxWidth = 680; // px
        const computed = Math.max(
            minWidth,
            Math.min(maxWidth, containerWidth - gutter)
        );

        root.style.setProperty("--bubbleWidthPx", `${Math.round(computed)}px`);
    }
}
