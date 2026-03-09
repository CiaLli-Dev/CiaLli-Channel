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

type MermaidLikeElement = {
    closest: (selector: string) => unknown;
};

type MermaidOffsetAxis = {
    centerOffset: number;
    minOffset: number;
    maxOffset: number;
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

const resolveMermaidOffsetAxis = (
    viewportSize: number,
    scaledContentSize: number,
): MermaidOffsetAxis => {
    const centerOffset = (viewportSize - scaledContentSize) / 2;
    return {
        centerOffset,
        minOffset: Math.min(0, viewportSize - scaledContentSize),
        maxOffset: 0,
    };
};

const clampMermaidOffsetOnAxis = (
    offset: number,
    axis: MermaidOffsetAxis,
): number => {
    if (axis.minOffset === 0) {
        return axis.centerOffset;
    }
    return clamp(offset, axis.minOffset, axis.maxOffset);
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

export const isSvgTag = (element: unknown): boolean => {
    if (!element || typeof element !== "object") {
        return false;
    }
    const tagName =
        "tagName" in element
            ? String((element as { tagName: unknown }).tagName)
            : "";
    return tagName.toLowerCase() === "svg";
};

export const resolveSvgAspectRatio = (element: Element): number => {
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

export const measureRectSize = (
    target: Pick<HTMLElement, "getBoundingClientRect">,
): { width: number; height: number } => {
    const rect = target.getBoundingClientRect();
    return {
        width: Math.max(0, Number(rect.width) || 0),
        height: Math.max(0, Number(rect.height) || 0),
    };
};

export const clampMermaidOffsets = (
    state: MermaidInteractionState,
    measurements: MermaidInteractionMeasurements,
): Pick<MermaidInteractionState, "offsetX" | "offsetY"> => {
    const scaledWidth = measurements.contentWidth * state.scale;
    const scaledHeight = measurements.contentHeight * state.scale;
    const xAxis = resolveMermaidOffsetAxis(
        measurements.viewportWidth,
        scaledWidth,
    );
    const yAxis = resolveMermaidOffsetAxis(
        measurements.viewportHeight,
        scaledHeight,
    );

    return {
        offsetX: clampMermaidOffsetOnAxis(state.offsetX, xAxis),
        offsetY: clampMermaidOffsetOnAxis(state.offsetY, yAxis),
    };
};

export const measureContentSize = (
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

export const getViewportAnchor = (
    viewport: HTMLElement,
    clientX: number,
    clientY: number,
): { x: number; y: number } => {
    const rect = viewport.getBoundingClientRect();
    return {
        x: clientX - rect.left,
        y: clientY - rect.top,
    };
};

export const createMermaidZoomButton = (
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
