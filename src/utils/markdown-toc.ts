export type CollectedMarkdownHeading = {
    id: string;
    text: string;
    depth: number;
    level: number;
    element: HTMLElement;
};

export const DEFAULT_MARKDOWN_ROOT_SELECTORS = [
    "#post-container .custom-md",
    "#post-container .markdown-content .custom-md",
    "#decrypted-content .custom-md",
    ".custom-md",
    "#post-container .markdown-content",
    "#decrypted-content .markdown-content",
    ".markdown-content",
] as const;

const HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]";

function normalizeHeadingText(raw: string): string {
    return raw
        .replace(/#+\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function getHeadingDepth(heading: HTMLElement): number {
    const value = Number.parseInt(heading.tagName.substring(1), 10);
    if (Number.isNaN(value) || value < 1 || value > 6) {
        return 6;
    }
    return value;
}

function isVisibleElement(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
        return false;
    }
    return element.getClientRects().length > 0;
}

function hasHeadingChildren(root: ParentNode): boolean {
    return root.querySelector(HEADING_SELECTOR) instanceof HTMLElement;
}

function findBestRootFromSelector(
    root: ParentNode,
    selector: string,
): HTMLElement | null {
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (elements.length === 0) {
        return null;
    }

    const visibleMatch = elements.find(
        (element) => isVisibleElement(element) && hasHeadingChildren(element),
    );
    if (visibleMatch) {
        return visibleMatch;
    }

    return elements.find((element) => hasHeadingChildren(element)) || null;
}

export function resolveMarkdownRoot(
    selectors: readonly string[] = DEFAULT_MARKDOWN_ROOT_SELECTORS,
    root: ParentNode = document,
): HTMLElement | null {
    for (const selector of selectors) {
        const match = findBestRootFromSelector(root, selector);
        if (match) {
            return match;
        }
    }

    return null;
}

export function collectMarkdownHeadings(options?: {
    maxDepth?: number;
    root?: ParentNode | null;
    selectors?: readonly string[];
}): CollectedMarkdownHeading[] {
    const maxDepth = Math.max(1, options?.maxDepth ?? 3);
    const selectors = options?.selectors ?? DEFAULT_MARKDOWN_ROOT_SELECTORS;
    const root = options?.root ?? resolveMarkdownRoot(selectors, document);

    if (!root) {
        return [];
    }

    const headingElements = Array.from(
        root.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
    );
    if (headingElements.length === 0) {
        return [];
    }

    const normalized = headingElements
        .map((element) => {
            const id = element.id.trim();
            const text = normalizeHeadingText(element.textContent || "");
            return {
                id,
                text,
                depth: getHeadingDepth(element),
                element,
            };
        })
        .filter((item) => item.id.length > 0 && item.text.length > 0);

    if (normalized.length === 0) {
        return [];
    }

    const minDepth = Math.min(...normalized.map((item) => item.depth));
    return normalized
        .filter((item) => item.depth < minDepth + maxDepth)
        .map((item) => ({
            ...item,
            level: item.depth - minDepth + 1,
        }));
}
