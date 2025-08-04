export class DOMUtils {
    static createElement(tag, className, textContent) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    static getElementById(id) {
        return document.getElementById(id);
    }

    static querySelector(selector) {
        return document.querySelector(selector);
    }

    static removeElement(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }

    static scrollToBottom(container) {
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    static adjustTextareaHeight(textarea, maxHeight = 80) {
        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
        }
    }
}