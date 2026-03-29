export type ReadingProgressInput = {
    baselineY: number;
    contentTop: number;
    contentHeight: number;
};

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(100, Math.max(0, Math.round(value)));
}

export function calculateReadingProgressPercent(
    input: ReadingProgressInput,
): number {
    const { baselineY, contentTop, contentHeight } = input;

    if (
        !Number.isFinite(baselineY) ||
        !Number.isFinite(contentTop) ||
        !Number.isFinite(contentHeight) ||
        contentHeight <= 0
    ) {
        return 0;
    }

    const traversedHeight = baselineY - contentTop;
    const rawPercent = (traversedHeight / contentHeight) * 100;
    return clampPercent(rawPercent);
}
