import { describe, expect, it } from "vitest";

import {
    clampMermaidOffsets,
    MERMAID_MAX_SCALE,
    MERMAID_MIN_SCALE,
    MERMAID_SCALE_STEP,
    zoomMermaidState,
} from "@/scripts/markdown/mermaid/interaction";

describe("mermaid-interaction state helpers", () => {
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

    it("缩放步进常量保持在 1x 到 3x 的交互范围内", () => {
        expect(MERMAID_MIN_SCALE).toBe(1);
        expect(MERMAID_MAX_SCALE).toBe(3);
        expect(MERMAID_SCALE_STEP).toBeCloseTo(0.1);
    });
});
