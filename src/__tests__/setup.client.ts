import { afterEach, beforeEach, vi } from "vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: vi.fn((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

if (typeof window !== "undefined" && !window.PointerEvent) {
    Object.defineProperty(window, "PointerEvent", {
        configurable: true,
        writable: true,
        value: MouseEvent as unknown as typeof PointerEvent,
    });
}

if (typeof window !== "undefined" && !("requestAnimationFrame" in window)) {
    Object.defineProperty(window, "requestAnimationFrame", {
        configurable: true,
        writable: true,
        value: (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 16),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
        configurable: true,
        writable: true,
        value: (handle: number) => window.clearTimeout(handle),
    });
}

if (typeof HTMLElement !== "undefined") {
    HTMLElement.prototype.scrollIntoView ??= vi.fn();
}

beforeEach(() => {
    document.head?.replaceChildren();
    document.body?.replaceChildren();
});

afterEach(() => {
    document.head?.replaceChildren();
    document.body?.replaceChildren();
    vi.restoreAllMocks();
});
