import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    MermaidInteractionController,
    MERMAID_MAX_SCALE,
    MERMAID_MIN_SCALE,
    MERMAID_SCALE_STEP,
    mountMermaidInteraction,
} from "@/scripts/markdown/mermaid/interaction";

import {
    dispatchWheelEvent,
    setElementBoxSize,
    setElementRect,
} from "./dom-test-helpers";

const labels = {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    reset: "Reset",
};

function createSvgElement(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 640 320");
    svg.setAttribute("width", "640");
    svg.setAttribute("height", "320");
    setElementRect(svg, { width: 640, height: 320 });
    setElementBoxSize(svg, {
        scrollWidth: 640,
        scrollHeight: 320,
    });
    return svg;
}

function createDiagramRoot(optIn: boolean): HTMLDivElement {
    const host = document.createElement("div");
    if (optIn) {
        host.dataset.mermaidInteractive = "true";
    }
    const mermaid = document.createElement("div");
    mermaid.className = "mermaid";
    mermaid.appendChild(createSvgElement());
    host.appendChild(mermaid);
    document.body.appendChild(host);
    return host;
}

function configureMountedViewport(root: Element): HTMLDivElement {
    const viewport = root.querySelector<HTMLDivElement>(".mermaid-viewport");
    const wrapper = root.querySelector<HTMLDivElement>(".mermaid-zoom-wrapper");
    const svg = root.querySelector<SVGSVGElement>("svg");

    if (!viewport || !wrapper || !svg) {
        throw new Error("mermaid interaction DOM not found");
    }

    setElementRect(viewport, { width: 640, height: 320 });
    setElementBoxSize(viewport, {
        clientWidth: 640,
        clientHeight: 320,
    });
    setElementBoxSize(wrapper, {
        scrollWidth: 640,
        scrollHeight: 320,
    });
    setElementRect(svg, { width: 640, height: 320 });
    setElementBoxSize(svg, {
        scrollWidth: 640,
        scrollHeight: 320,
    });

    return viewport;
}

describe("mermaid-interaction mount", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("opt-in 容器首次注入控件，重复挂载不重复创建", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.querySelector<HTMLElement>(".mermaid");
        expect(mermaid).not.toBeNull();
        if (!mermaid) {
            return;
        }

        const controller = mountMermaidInteraction(mermaid, labels);
        expect(controller).toBeInstanceOf(MermaidInteractionController);
        configureMountedViewport(mermaid);

        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );

        mermaid.replaceChildren(createSvgElement());
        mountMermaidInteraction(mermaid, labels);
        configureMountedViewport(mermaid);

        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );
    });

    it("未标记 opt-in 时不启用交互", () => {
        const host = createDiagramRoot(false);
        const mermaid = host.querySelector<HTMLElement>(".mermaid");
        expect(mermaid).not.toBeNull();
        if (!mermaid) {
            return;
        }

        const controller = mountMermaidInteraction(mermaid, labels);

        expect(controller).toBeNull();
        expect(mermaid.querySelector(".mermaid-zoom-controls")).toBeNull();
    });
});

describe("mermaid-interaction controller", () => {
    it("按钮缩放、拖拽和重置都维持用户可观察的缩放状态", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.querySelector<HTMLElement>(".mermaid");
        expect(mermaid).not.toBeNull();
        if (!mermaid) {
            return;
        }

        const controller = mountMermaidInteraction(mermaid, labels);
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }
        configureMountedViewport(mermaid);
        controller.reset();

        Array.from({ length: 30 }).forEach(() => controller.zoomIn());
        expect(controller.getState().scale).toBe(MERMAID_MAX_SCALE);

        controller.zoomOut();
        expect(controller.getState().scale).toBeLessThan(MERMAID_MAX_SCALE);

        expect(controller.startDrag(1, 50, 50)).toBe(true);
        controller.moveDrag(1, -200, 50);
        controller.endDrag(1);

        const draggedState = controller.getState();
        expect(draggedState.offsetX).toBeLessThan(0);
        expect(Number.isFinite(draggedState.offsetX)).toBe(true);

        controller.reset();
        expect(controller.getState().scale).toBe(MERMAID_MIN_SCALE);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(Number.isFinite(controller.getState().offsetY)).toBe(true);
    });

    it("悬停滚轮会以鼠标位置为锚点缩放并阻止页面滚动穿透", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.querySelector<HTMLElement>(".mermaid");
        expect(mermaid).not.toBeNull();
        if (!mermaid) {
            return;
        }

        const controller = mountMermaidInteraction(mermaid, labels);
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        const viewport = configureMountedViewport(mermaid);
        controller.reset();

        const zoomInEvent = dispatchWheelEvent(viewport, {
            deltaY: -100,
            clientX: 100,
            clientY: 80,
        });

        const afterZoomIn = controller.getState();
        expect(zoomInEvent.defaultPrevented).toBe(true);
        expect(afterZoomIn.scale).toBeCloseTo(1 + MERMAID_SCALE_STEP);
        expect(afterZoomIn.offsetX).toBeCloseTo(-10);
        expect(afterZoomIn.offsetY).toBeCloseTo(-8);

        dispatchWheelEvent(viewport, {
            deltaY: 100,
            clientX: 100,
            clientY: 80,
        });

        const afterZoomOut = controller.getState();
        expect(afterZoomOut.scale).toBe(MERMAID_MIN_SCALE);
        expect(afterZoomOut.offsetX).toBe(0);
        expect(afterZoomOut.offsetY).toBe(0);
    });

    it("主题重渲染时保留控件并重置缩放状态", () => {
        const host = createDiagramRoot(true);
        const mermaid = host.querySelector<HTMLElement>(".mermaid");
        expect(mermaid).not.toBeNull();
        if (!mermaid) {
            return;
        }

        const controller = mountMermaidInteraction(mermaid, labels);
        expect(controller).not.toBeNull();
        if (!controller) {
            return;
        }

        configureMountedViewport(mermaid);
        controller.reset();
        controller.zoomIn();
        controller.zoomIn();
        expect(controller.getState().scale).toBeGreaterThan(1);

        mermaid.replaceChildren(createSvgElement());
        mountMermaidInteraction(mermaid, labels);
        configureMountedViewport(mermaid);

        expect(mermaid.querySelectorAll(".mermaid-zoom-controls")).toHaveLength(
            1,
        );
        expect(controller.getState().scale).toBe(1);
        expect(Number.isFinite(controller.getState().offsetX)).toBe(true);
        expect(Number.isFinite(controller.getState().offsetY)).toBe(true);
    });
});
