import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    MERMAID_MIN_SCALE,
    MERMAID_SCALE_STEP,
    MERMAID_MAX_SCALE,
    MermaidInteractionController,
    clampMermaidOffsets,
    mountMermaidInteraction,
    zoomMermaidState,
} from "@/scripts/mermaid-interaction";

class FakeClassList {
    private readonly values = new Set<string>();

    constructor(private readonly owner: FakeElement) {}

    add(...tokens: string[]): void {
        tokens.forEach((token) => {
            if (token) {
                this.values.add(token);
            }
        });
        this.sync();
    }

    remove(...tokens: string[]): void {
        tokens.forEach((token) => {
            this.values.delete(token);
        });
        this.sync();
    }

    contains(token: string): boolean {
        return this.values.has(token);
    }

    setFromClassName(value: string): void {
        this.values.clear();
        value
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((token) => {
                this.values.add(token);
            });
        this.sync();
    }

    private sync(): void {
        this.owner.className = Array.from(this.values).join(" ");
    }
}

class FakeElement {
    readonly children: FakeElement[] = [];

    readonly style: Record<string, string> = {};

    readonly dataset: Record<string, string> = {};

    readonly listeners = new Map<string, ((event: unknown) => void)[]>();

    readonly classList = new FakeClassList(this);

    parentElement: FakeElement | null = null;

    textContent = "";

    private readonly attributes = new Map<string, string>();

    private rectWidth = 0;

    private rectHeight = 0;

    className = "";

    disabled = false;

    title = "";

    constructor(readonly tagName: string) {}

    append(...nodes: FakeElement[]): void {
        nodes.forEach((node) => this.appendChild(node));
    }

    appendChild(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...nodes: FakeElement[]): void {
        this.children.splice(0, this.children.length);
        nodes.forEach((node) => {
            node.parentElement = this;
            this.children.push(node);
        });
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === "class") {
            this.classList.setFromClassName(value);
        }
        if (name.startsWith("data-")) {
            const datasetKey = name
                .slice(5)
                .replace(/-([a-z])/g, (_, letter: string) =>
                    letter.toUpperCase(),
                );
            this.dataset[datasetKey] = value;
        }
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
        if (name.startsWith("data-")) {
            const datasetKey = name
                .slice(5)
                .replace(/-([a-z])/g, (_, letter: string) =>
                    letter.toUpperCase(),
                );
            delete this.dataset[datasetKey];
        }
    }

    addEventListener(
        type: string,
        listener: (event: unknown) => void,
        _options?: AddEventListenerOptions,
    ): void {
        const existing = this.listeners.get(type) ?? [];
        existing.push(listener);
        this.listeners.set(type, existing);
    }

    dispatch(type: string, event: unknown): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.forEach((listener) => listener(event));
    }

    closest(selector: string): FakeElement | null {
        if (selector === '[data-mermaid-interactive="true"]') {
            if (this.getAttribute("data-mermaid-interactive") === "true") {
                return this;
            }
            return this.parentElement?.closest(selector) ?? null;
        }
        return null;
    }

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const matcher = selector.startsWith(".")
            ? (node: FakeElement) =>
                  node.className
                      .split(/\s+/)
                      .filter(Boolean)
                      .includes(selector.slice(1))
            : (node: FakeElement) =>
                  node.tagName.toLowerCase() === selector.toLowerCase();

        const output: FakeElement[] = [];
        const walk = (node: FakeElement): void => {
            node.children.forEach((child) => {
                if (matcher(child)) {
                    output.push(child);
                }
                walk(child);
            });
        };
        walk(this);
        return output;
    }

    setDimensions(width: number, height: number): void {
        this.rectWidth = width;
        this.rectHeight = height;
    }

    get scrollWidth(): number {
        if (this.rectWidth > 0) {
            return this.rectWidth;
        }
        return this.children[0]?.scrollWidth ?? 0;
    }

    get scrollHeight(): number {
        if (this.rectHeight > 0) {
            return this.rectHeight;
        }
        return this.children[0]?.scrollHeight ?? 0;
    }

    get clientWidth(): number {
        return this.rectWidth;
    }

    get clientHeight(): number {
        return this.rectHeight;
    }

    get firstElementChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    getBoundingClientRect(): DOMRect {
        const width =
            this.rectWidth ||
            (this.className.includes("mermaid-viewport")
                ? 640
                : (this.children[0]?.scrollWidth ?? 0));
        const height =
            this.rectHeight ||
            (this.className.includes("mermaid-viewport")
                ? 320
                : (this.children[0]?.scrollHeight ?? 0));
        return {
            width,
            height,
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            x: 0,
            y: 0,
            toJSON: () => "",
        } as DOMRect;
    }
}

type FakeDocument = {
    createElement: (tagName: string) => FakeElement;
};

const createFakeDocument = (): FakeDocument => ({
    createElement: (tagName: string) => new FakeElement(tagName),
});

const createSvgElement = (): FakeElement => {
    const svg = new FakeElement("svg");
    svg.setDimensions(640, 320);
    return svg;
};

const createDiagramRoot = (optIn: boolean): FakeElement => {
    const host = new FakeElement("div");
    if (optIn) {
        host.setAttribute("data-mermaid-interactive", "true");
    }
    const mermaid = new FakeElement("div");
    mermaid.className = "mermaid";
    host.appendChild(mermaid);
    mermaid.appendChild(createSvgElement());
    return host;
};

const labels = {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Reset",
};

const setupMermaidInteractionTestEnvironment = (): void => {
    beforeEach(() => {
        vi.stubGlobal("document", createFakeDocument() as unknown as Document);
        vi.stubGlobal("window", {
            matchMedia: () => ({ matches: false }),
        } as unknown as Window & typeof globalThis);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });
};

describe("mermaid-interaction mount", () => {
    setupMermaidInteractionTestEnvironment();

    it("opt-in 容器首次注入控件，重复挂载不重复创建", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );

        expect(controller).toBeInstanceOf(MermaidInteractionController);
        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );

        mermaid.replaceChildren(createSvgElement());
        mountMermaidInteraction(mermaid as unknown as HTMLElement, labels);

        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );
    });

    it("未标记 opt-in 时不启用交互", () => {
        const host = createDiagramRoot(false);
        const mermaid = host.children[0];

        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );

        expect(controller).toBeNull();
        expect(mermaid.querySelector(".mermaid-zoom-controls")).toBeNull();
    });
});

describe("mermaid-interaction state", () => {
    setupMermaidInteractionTestEnvironment();

    it("Zoom In / Zoom Out / Reset 收敛在 1x 到 3x 之间", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        Array.from({ length: 30 }).forEach(() => controller.zoomIn());
        expect(controller.getState().scale).toBe(MERMAID_MAX_SCALE);

        controller.zoomOut();
        expect(controller.getState().scale).toBeLessThan(MERMAID_MAX_SCALE);

        controller.reset();
        expect(controller.getState().scale).toBe(1);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(Number.isFinite(controller.getState().offsetY)).toBe(true);
    });

    it("锚点缩放时保留锚点，不再强制横向居中", () => {
        const nextState = zoomMermaidState(
            {
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                minScale: 1,
                maxScale: 3,
                pointerId: null,
                pointerX: 0,
                pointerY: 0,
            },
            {
                viewportWidth: 640,
                viewportHeight: 320,
                contentWidth: 640,
                contentHeight: 320,
            },
            1.1,
            160,
            80,
        );

        expect(nextState.scale).toBe(1.1);
        expect(nextState.offsetX).toBeCloseTo(-16);
        expect(nextState.offsetY).toBeCloseTo(-8);
    });

    it("仅在放大后允许拖拽，并且拖拽位移始终 clamp", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        expect(controller.startDrag(1, 50, 50)).toBe(false);

        controller.zoomIn();
        expect(controller.startDrag(1, 50, 50)).toBe(true);
        controller.moveDrag(1, 1000, 1000);
        expect(controller.getState().offsetX).toBe(0);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(controller.getState().offsetY).toBe(0);

        controller.moveDrag(1, -1000, -1000);
        expect(controller.getState().offsetX).toBeGreaterThanOrEqual(-64);
        expect(controller.getState().offsetX).toBe(-64);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(controller.getState().offsetY).toBeGreaterThanOrEqual(-32);
        controller.endDrag(1);
        expect(controller.getState().pointerId).toBeNull();
    });

    it("按钮缩放会保持当前视角，不会每次重新居中", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        controller.zoomIn();
        expect(controller.startDrag(1, 50, 50)).toBe(true);
        controller.moveDrag(1, -200, 50);
        controller.endDrag(1);

        const beforeZoom = controller.getState();
        expect(beforeZoom.offsetX).toBe(-64);

        controller.zoomIn();

        const afterZoom = controller.getState();
        expect(afterZoom.scale).toBeCloseTo(1 + MERMAID_SCALE_STEP * 2);
        expect(afterZoom.offsetX).toBeLessThan(-64);
    });

    it("主题重渲染时保留控件并重置缩放状态", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        controller.zoomIn();
        controller.zoomIn();
        expect(controller.getState().scale).toBeGreaterThan(1);

        mermaid.replaceChildren(createSvgElement());
        mountMermaidInteraction(mermaid as unknown as HTMLElement, labels);

        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );
        expect(controller.getState().scale).toBe(1);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(Number.isFinite(controller.getState().offsetY)).toBe(true);
    });

    it("clampMermaidOffsets 不允许露出空白边界", () => {
        const offsets = clampMermaidOffsets(
            {
                scale: 1.5,
                offsetX: -500,
                offsetY: 500,
                minScale: 1,
                maxScale: 3,
                pointerId: null,
                pointerX: 0,
                pointerY: 0,
            },
            {
                viewportWidth: 640,
                viewportHeight: 320,
                contentWidth: 640,
                contentHeight: 320,
            },
        );

        expect(offsets.offsetX).toBe(-320);
        expect(offsets.offsetY).toBe(0);
    });
});

describe("mermaid-interaction controller", () => {
    setupMermaidInteractionTestEnvironment();

    it("悬停滚轮会以鼠标位置为锚点缩放并阻止页面滚动穿透", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.children[0];
        const controller = mountMermaidInteraction(
            mermaid as unknown as HTMLElement,
            labels,
        );
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        const viewport = mermaid.querySelector(".mermaid-viewport");
        expect(viewport).not.toBeNull();
        if (!viewport) {
            return;
        }

        let defaultPrevented = false;
        viewport.dispatch("wheel", {
            deltaY: -100,
            clientX: 100,
            clientY: 80,
            preventDefault: () => {
                defaultPrevented = true;
            },
        });

        const afterZoomIn = controller.getState();
        expect(defaultPrevented).toBe(true);
        expect(afterZoomIn.scale).toBeCloseTo(1 + MERMAID_SCALE_STEP);
        expect(afterZoomIn.offsetX).toBeCloseTo(-10);
        expect(afterZoomIn.offsetY).toBeCloseTo(-8);

        viewport.dispatch("wheel", {
            deltaY: 100,
            clientX: 100,
            clientY: 80,
            preventDefault: () => undefined,
        });

        const afterZoomOut = controller.getState();
        expect(afterZoomOut.scale).toBe(MERMAID_MIN_SCALE);
        expect(afterZoomOut.offsetX).toBe(0);
        expect(afterZoomOut.offsetY).toBe(0);
    });
});
