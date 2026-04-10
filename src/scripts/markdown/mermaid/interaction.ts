import {
    clampMermaidOffsets,
    createMermaidInteractionLabels,
    createMermaidZoomButton,
    getCenteredMermaidOffsets,
    getViewportAnchor,
    isMermaidInteractionEnabled,
    isSvgTag,
    measureContentSize,
    measureRectSize,
    MERMAID_MAX_SCALE,
    MERMAID_MIN_SCALE,
    MERMAID_SCALE_STEP,
    resolveSvgAspectRatio,
    zoomMermaidState,
} from "@/scripts/markdown/mermaid/interaction-helpers";
import type {
    MermaidInteractionLabels,
    MermaidInteractionMeasurements,
    MermaidInteractionState,
} from "@/scripts/markdown/mermaid/interaction-helpers";

export {
    clampMermaidOffsets,
    createMermaidInteractionLabels,
    getCenteredMermaidOffsets,
    isMermaidInteractionEnabled,
    MERMAID_MAX_SCALE,
    MERMAID_MIN_SCALE,
    MERMAID_SCALE_STEP,
    zoomMermaidState,
} from "@/scripts/markdown/mermaid/interaction-helpers";
export type {
    MermaidInteractionLabels,
    MermaidInteractionMeasurements,
    MermaidInteractionState,
} from "@/scripts/markdown/mermaid/interaction-helpers";

type MermaidInteractiveElement = HTMLElement & {
    __mermaidInteractionController?: MermaidInteractionController;
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

        this.zoomOutButton = createMermaidZoomButton(
            "material-symbols:remove-rounded",
            labels.zoomOut,
            "zoom-out",
        );
        this.zoomInButton = createMermaidZoomButton(
            "material-symbols:add-rounded",
            labels.zoomIn,
            "zoom-in",
        );
        this.resetButton = createMermaidZoomButton(
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
        this.applyScaleAtViewportCenter(
            this.state.scale + MERMAID_SCALE_STEP,
            measurements,
        );
    }

    zoomOut(): void {
        const measurements = this.measure();
        this.applyScaleAtViewportCenter(
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

        this.viewport.addEventListener(
            "wheel",
            (event: WheelEvent) => {
                if (event.deltaY === 0) {
                    return;
                }

                // 桌面端悬停滚轮直接缩放，并以鼠标所在图内位置为锚点保留当前视角。
                const direction = Math.sign(event.deltaY);
                const { x, y } = getViewportAnchor(
                    this.viewport,
                    event.clientX,
                    event.clientY,
                );
                const measurements = this.measure();
                this.applyAnchoredScale(
                    this.state.scale - direction * MERMAID_SCALE_STEP,
                    measurements,
                    x,
                    y,
                );
                event.preventDefault();
            },
            { passive: false },
        );

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

    private applyScaleAtViewportCenter(
        nextScale: number,
        measurements: MermaidInteractionMeasurements,
    ): void {
        this.applyAnchoredScale(
            nextScale,
            measurements,
            measurements.viewportWidth / 2,
            measurements.viewportHeight / 2,
        );
    }

    private applyAnchoredScale(
        nextScale: number,
        measurements: MermaidInteractionMeasurements,
        anchorX: number,
        anchorY: number,
    ): void {
        this.state = zoomMermaidState(
            this.state,
            measurements,
            nextScale,
            anchorX,
            anchorY,
        );
        this.endDrag();
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
