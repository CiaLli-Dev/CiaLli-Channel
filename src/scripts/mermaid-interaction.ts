import I18nKey from "@i18n/i18nKey";

import { clamp } from "@/scripts/dom-helpers";
import { t } from "@/scripts/i18n-runtime";

export const MERMAID_MIN_SCALE = 1;
export const MERMAID_MAX_SCALE = 3;
export const MERMAID_SCALE_STEP = 0.1;

export type MermaidInteractionLabels = {
    zoomIn: string;
    zoomOut: string;
    reset: string;
};

export type MermaidInteractionMeasurements = {
    viewportWidth: number;
    viewportHeight: number;
    contentWidth: number;
    contentHeight: number;
};

export type MermaidInteractionState = {
    scale: number;
    offsetX: number;
    offsetY: number;
    minScale: number;
    maxScale: number;
    pointerId: number | null;
    pointerX: number;
    pointerY: number;
};

type MermaidInteractiveElement = HTMLElement & {
    __mermaidInteractionController?: MermaidInteractionController;
};

type MermaidLikeElement = {
    closest: (selector: string) => unknown;
};

const isCoarsePointerDevice = (): boolean => {
    if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
    ) {
        return false;
    }
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
};

const isSvgTag = (element: unknown): boolean => {
    if (!element || typeof element !== "object") {
        return false;
    }
    const tagName =
        "tagName" in element
            ? String((element as { tagName: unknown }).tagName)
            : "";
    return tagName.toLowerCase() === "svg";
};

const resolveSvgAspectRatio = (element: Element): number => {
    const viewBox = element.getAttribute("viewBox");
    if (viewBox) {
        const [, , width, height] = viewBox
            .split(/[\s,]+/)
            .map((item) => Number.parseFloat(item));
        if (
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0
        ) {
            return width / height;
        }
    }

    const width = Number.parseFloat(element.getAttribute("width") || "");
    const height = Number.parseFloat(element.getAttribute("height") || "");
    if (
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
    ) {
        return width / height;
    }

    return 1;
};

const measureRectSize = (
    target: Pick<HTMLElement, "getBoundingClientRect">,
): { width: number; height: number } => {
    const rect = target.getBoundingClientRect();
    return {
        width: Math.max(0, Number(rect.width) || 0),
        height: Math.max(0, Number(rect.height) || 0),
    };
};

export const createMermaidInteractionLabels = (): MermaidInteractionLabels => ({
    zoomIn: t(I18nKey.interactionCommonZoomIn),
    zoomOut: t(I18nKey.interactionCommonZoomOut),
    reset: t(I18nKey.interactionCommonReset),
});

export const isMermaidInteractionEnabled = (
    element: MermaidLikeElement | null,
): boolean => {
    if (!element || isCoarsePointerDevice()) {
        return false;
    }
    return Boolean(element.closest('[data-mermaid-interactive="true"]'));
};

export const clampMermaidOffsets = (
    state: MermaidInteractionState,
    measurements: MermaidInteractionMeasurements,
): Pick<MermaidInteractionState, "offsetX" | "offsetY"> => {
    const scaledWidth = measurements.contentWidth * state.scale;
    const scaledHeight = measurements.contentHeight * state.scale;
    const centeredOffsetX = (measurements.viewportWidth - scaledWidth) / 2;
    const centeredOffsetY = (measurements.viewportHeight - scaledHeight) / 2;

    if (scaledWidth <= measurements.viewportWidth) {
        return {
            offsetX: centeredOffsetX,
            offsetY:
                scaledHeight <= measurements.viewportHeight
                    ? centeredOffsetY
                    : clamp(
                          state.offsetY,
                          measurements.viewportHeight - scaledHeight,
                          0,
                      ),
        };
    }

    const minOffsetY = Math.min(0, measurements.viewportHeight - scaledHeight);

    return {
        // 横向视角强制保持在中间，不允许拖到靠左或靠右。
        offsetX: centeredOffsetX,
        offsetY:
            scaledHeight <= measurements.viewportHeight
                ? centeredOffsetY
                : clamp(state.offsetY, minOffsetY, 0),
    };
};

const measureContentSize = (
    wrapper: HTMLElement,
    scale: number,
): { width: number; height: number } => {
    const contentElement = wrapper.firstElementChild;
    const safeScale = scale > 0 ? scale : 1;
    const measuredElement =
        contentElement &&
        "getBoundingClientRect" in contentElement &&
        "scrollWidth" in contentElement &&
        "scrollHeight" in contentElement
            ? (contentElement as HTMLElement)
            : null;
    if (measuredElement) {
        const rect = measuredElement.getBoundingClientRect();
        const width = Math.max(
            0,
            (Number(rect.width) || 0) / safeScale,
            Number(measuredElement.scrollWidth) || 0,
        );
        const height = Math.max(
            0,
            (Number(rect.height) || 0) / safeScale,
            Number(measuredElement.scrollHeight) || 0,
        );
        if (width > 0 && height > 0) {
            return { width, height };
        }
    }

    return {
        width: Math.max(0, (Number(wrapper.scrollWidth) || 0) / safeScale),
        height: Math.max(0, (Number(wrapper.scrollHeight) || 0) / safeScale),
    };
};

export const getCenteredMermaidOffsets = (
    scale: number,
    measurements: MermaidInteractionMeasurements,
): Pick<MermaidInteractionState, "offsetX" | "offsetY"> => ({
    offsetX:
        (measurements.viewportWidth - measurements.contentWidth * scale) / 2,
    offsetY:
        (measurements.viewportHeight - measurements.contentHeight * scale) / 2,
});

export const zoomMermaidState = (
    state: MermaidInteractionState,
    measurements: MermaidInteractionMeasurements,
    nextScale: number,
    anchorX: number,
    anchorY: number,
): MermaidInteractionState => {
    const safeScale = clamp(nextScale, state.minScale, state.maxScale);
    const safeAnchorX = clamp(anchorX, 0, measurements.viewportWidth);
    const safeAnchorY = clamp(anchorY, 0, measurements.viewportHeight);

    // 以当前光标所在的图内坐标为锚点缩放，避免缩放时出现“跳一下”的错位感。
    const contentPointX = (safeAnchorX - state.offsetX) / state.scale;
    const contentPointY = (safeAnchorY - state.offsetY) / state.scale;
    const nextState: MermaidInteractionState = {
        ...state,
        scale: safeScale,
        offsetX: safeAnchorX - contentPointX * safeScale,
        offsetY: safeAnchorY - contentPointY * safeScale,
    };

    const clampedOffsets = clampMermaidOffsets(nextState, measurements);
    return {
        ...nextState,
        ...clampedOffsets,
    };
};

const createButton = (
    icon: string,
    ariaLabel: string,
    action: string,
): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mermaid-zoom-button";
    button.title = ariaLabel;
    button.setAttribute("aria-label", ariaLabel);
    button.dataset.action = action;
    const iconElement = document.createElement("iconify-icon");
    iconElement.className = "mermaid-zoom-icon";
    iconElement.setAttribute("icon", icon);
    iconElement.setAttribute("aria-hidden", "true");
    button.appendChild(iconElement);
    return button;
};

export class MermaidInteractionController {
    private readonly shell: HTMLDivElement;

    private readonly controls: HTMLDivElement;

    private readonly viewport: HTMLDivElement;

    private readonly wrapper: HTMLDivElement;

    private readonly zoomOutButton: HTMLButtonElement;

    private readonly zoomInButton: HTMLButtonElement;

    private readonly resetButton: HTMLButtonElement;

    private state: MermaidInteractionState = {
        scale: MERMAID_MIN_SCALE,
        offsetX: 0,
        offsetY: 0,
        minScale: MERMAID_MIN_SCALE,
        maxScale: MERMAID_MAX_SCALE,
        pointerId: null,
        pointerX: 0,
        pointerY: 0,
    };

    constructor(
        private readonly root: HTMLElement,
        labels: MermaidInteractionLabels = createMermaidInteractionLabels(),
    ) {
        this.shell = document.createElement("div");
        this.shell.className = "mermaid-interaction-shell";

        this.controls = document.createElement("div");
        this.controls.className = "mermaid-zoom-controls";

        this.viewport = document.createElement("div");
        this.viewport.className = "mermaid-viewport";

        this.wrapper = document.createElement("div");
        this.wrapper.className = "mermaid-zoom-wrapper";

        this.zoomOutButton = createButton(
            "material-symbols:remove-rounded",
            labels.zoomOut,
            "zoom-out",
        );
        this.zoomInButton = createButton(
            "material-symbols:add-rounded",
            labels.zoomIn,
            "zoom-in",
        );
        this.resetButton = createButton(
            "material-symbols:restart-alt-rounded",
            labels.reset,
            "reset",
        );

        this.controls.append(
            this.zoomOutButton,
            this.zoomInButton,
            this.resetButton,
        );
        this.viewport.appendChild(this.wrapper);
        this.shell.append(this.controls, this.viewport);

        this.bindEvents();
        this.syncUiState();
    }

    getState(): MermaidInteractionState {
        return { ...this.state };
    }

    mountSvg(svgElement: Element): void {
        if (!isSvgTag(svgElement)) {
            return;
        }

        const svg = svgElement as HTMLElement;
        const aspectRatio = resolveSvgAspectRatio(svgElement);
        const isPortraitDiagram = aspectRatio < 0.9;
        this.root.setAttribute(
            "data-mermaid-layout",
            isPortraitDiagram ? "portrait" : "wide",
        );

        // 横向图优先铺满容器，竖向图保留原始比例，避免一刀切宽度策略带来裁切或高度暴涨。
        svg.style.maxWidth = "100%";
        svg.style.width = isPortraitDiagram ? "" : "100%";
        svg.style.height = isPortraitDiagram ? "" : "auto";
        svg.style.display = "block";
        svg.style.pointerEvents = "none";
        this.wrapper.replaceChildren(svg);
        this.root.replaceChildren(this.shell);
        this.reset();
    }

    zoomIn(): void {
        const measurements = this.measure();
        this.applyCenteredScale(
            this.state.scale + MERMAID_SCALE_STEP,
            measurements,
        );
    }

    zoomOut(): void {
        const measurements = this.measure();
        this.applyCenteredScale(
            this.state.scale - MERMAID_SCALE_STEP,
            measurements,
        );
    }

    reset(): void {
        const measurements = this.measure();
        this.state = {
            ...this.state,
            scale: MERMAID_MIN_SCALE,
            ...getCenteredMermaidOffsets(MERMAID_MIN_SCALE, measurements),
            pointerId: null,
            pointerX: 0,
            pointerY: 0,
        };
        this.syncTransform();
    }

    startDrag(pointerId: number, clientX: number, clientY: number): boolean {
        if (this.state.scale <= this.state.minScale) {
            return false;
        }
        this.state = {
            ...this.state,
            pointerId,
            pointerX: clientX,
            pointerY: clientY,
        };
        this.root.setAttribute("data-mermaid-dragging", "true");
        return true;
    }

    moveDrag(pointerId: number, clientX: number, clientY: number): void {
        if (this.state.pointerId !== pointerId) {
            return;
        }

        // 拖拽只累计指针增量，再统一做边界收敛，避免不同缩放倍率下出现位移穿帮。
        const nextState: MermaidInteractionState = {
            ...this.state,
            offsetX: this.state.offsetX + (clientX - this.state.pointerX),
            offsetY: this.state.offsetY + (clientY - this.state.pointerY),
            pointerX: clientX,
            pointerY: clientY,
        };
        const clampedOffsets = clampMermaidOffsets(nextState, this.measure());
        this.state = {
            ...nextState,
            ...clampedOffsets,
        };
        this.syncTransform();
    }

    endDrag(pointerId: number | null = null): void {
        if (pointerId !== null && this.state.pointerId !== pointerId) {
            return;
        }
        this.state = {
            ...this.state,
            pointerId: null,
        };
        this.root.removeAttribute("data-mermaid-dragging");
        this.syncUiState();
    }

    private bindEvents(): void {
        this.zoomOutButton.addEventListener("click", () => {
            this.zoomOut();
        });
        this.zoomInButton.addEventListener("click", () => {
            this.zoomIn();
        });
        this.resetButton.addEventListener("click", () => {
            this.reset();
        });

        this.viewport.addEventListener("pointerdown", (event: PointerEvent) => {
            if (
                !this.startDrag(event.pointerId, event.clientX, event.clientY)
            ) {
                return;
            }
            this.viewport.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });

        this.viewport.addEventListener("pointermove", (event: PointerEvent) => {
            this.moveDrag(event.pointerId, event.clientX, event.clientY);
            if (this.state.pointerId === event.pointerId) {
                event.preventDefault();
            }
        });

        const releaseDrag = (event: PointerEvent): void => {
            if (this.viewport.hasPointerCapture?.(event.pointerId)) {
                this.viewport.releasePointerCapture(event.pointerId);
            }
            this.endDrag(event.pointerId);
        };

        this.viewport.addEventListener("pointerup", releaseDrag);
        this.viewport.addEventListener("pointercancel", releaseDrag);
        this.viewport.addEventListener("pointerleave", releaseDrag);
    }

    private measure(): MermaidInteractionMeasurements {
        const viewportRect = measureRectSize(this.viewport);
        const viewportWidth = Math.max(
            1,
            viewportRect.width || Number(this.viewport.clientWidth) || 0,
        );
        const viewportHeight = Math.max(
            1,
            viewportRect.height || Number(this.viewport.clientHeight) || 0,
        );
        // wrapper 已经带有当前缩放 transform，这里需要还原到 1x 基准尺寸，
        // 否则会把上一次缩放后的宽高再次乘进去，造成每次缩放都持续向左漂移。
        const contentSize = measureContentSize(this.wrapper, this.state.scale);
        const contentWidth = Math.max(1, contentSize.width);
        const contentHeight = Math.max(1, contentSize.height);

        return {
            viewportWidth,
            viewportHeight,
            contentWidth,
            contentHeight,
        };
    }

    private applyCenteredScale(
        nextScale: number,
        measurements: MermaidInteractionMeasurements,
    ): void {
        const scale = clamp(
            nextScale,
            this.state.minScale,
            this.state.maxScale,
        );
        this.state = {
            ...this.state,
            scale,
            ...getCenteredMermaidOffsets(scale, measurements),
        };
        this.syncTransform();
    }

    private syncTransform(): void {
        this.wrapper.style.transformOrigin = "0 0";
        this.wrapper.style.transform = `translate3d(${this.state.offsetX}px, ${this.state.offsetY}px, 0) scale(${this.state.scale})`;
        this.syncUiState();
    }

    private syncUiState(): void {
        this.root.setAttribute(
            "data-mermaid-zoomed",
            this.state.scale > this.state.minScale ? "true" : "false",
        );
        if (this.state.pointerId === null) {
            this.root.removeAttribute("data-mermaid-dragging");
        }
        this.zoomOutButton.disabled = this.state.scale <= this.state.minScale;
        this.zoomInButton.disabled = this.state.scale >= this.state.maxScale;
        this.resetButton.disabled = this.state.scale === this.state.minScale;
    }
}

export const mountMermaidInteraction = (
    element: HTMLElement,
    labels: MermaidInteractionLabels = createMermaidInteractionLabels(),
): MermaidInteractionController | null => {
    if (!isMermaidInteractionEnabled(element)) {
        return null;
    }

    const svgElement = element.querySelector("svg");
    if (!isSvgTag(svgElement)) {
        return null;
    }
    const renderedSvg = svgElement as Element;

    const interactiveElement = element as MermaidInteractiveElement;
    if (!interactiveElement.__mermaidInteractionController) {
        interactiveElement.__mermaidInteractionController =
            new MermaidInteractionController(element, labels);
    }
    interactiveElement.__mermaidInteractionController.mountSvg(renderedSvg);
    return interactiveElement.__mermaidInteractionController;
};
