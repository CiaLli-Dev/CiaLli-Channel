const DEFAULT_TOC_BASELINE_OFFSET = 80;
const TOC_BASELINE_GAP = 8;

function getElementBottom(element: HTMLElement | null): number {
    if (!element) {
        return 0;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
        return 0;
    }

    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) {
        return 0;
    }

    return Math.max(0, rect.bottom);
}

export function getTocBaselineOffset(extraOffset = 0): number {
    const navbarWrapper = document.getElementById("navbar-wrapper");
    const navbar = document.getElementById("navbar");

    const navbarBottom = Math.max(
        getElementBottom(navbarWrapper),
        getElementBottom(navbar),
    );

    const baseOffset =
        navbarBottom > 0
            ? navbarBottom + TOC_BASELINE_GAP
            : DEFAULT_TOC_BASELINE_OFFSET;

    return Math.round(Math.max(0, baseOffset + extraOffset));
}
