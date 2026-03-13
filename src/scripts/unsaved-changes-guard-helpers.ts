export type HistoryStateLike = {
    index?: unknown;
};

export type ClickLike = {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
};

export function getHistoryStateIndex(state: unknown): number | null {
    const candidate = state as HistoryStateLike | null;
    return typeof candidate?.index === "number" ? candidate.index : null;
}

export function isModifiedPrimaryClick(event: ClickLike): boolean {
    return (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    );
}

export function shouldIgnoreAnchorNavigation(params: {
    hasDownload: boolean;
    target: string;
}): boolean {
    if (params.hasDownload) {
        return true;
    }
    return Boolean(params.target && params.target !== "_self");
}

export function isSameDocumentHashNavigation(
    currentHref: string,
    targetHref: string,
): boolean {
    const currentUrl = new URL(currentHref);
    const targetUrl = new URL(targetHref, currentUrl);
    return (
        targetUrl.origin === currentUrl.origin &&
        targetUrl.pathname === currentUrl.pathname &&
        targetUrl.search === currentUrl.search
    );
}

export function getPopstateRollbackDelta(
    currentHistoryIndex: number | null,
    nextHistoryIndex: number | null,
): number | null {
    if (
        currentHistoryIndex === null ||
        nextHistoryIndex === null ||
        currentHistoryIndex === nextHistoryIndex
    ) {
        return null;
    }
    return nextHistoryIndex > currentHistoryIndex ? -1 : 1;
}
