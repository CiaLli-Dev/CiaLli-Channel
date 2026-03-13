export type AutoScrollConfig = {
    minDurationMs: number;
    maxDurationMs: number;
    stepRatio: number;
    minStepPx: number;
    fadePx: number;
    triggerPaddingPx: number;
    safeInsetPx: number;
};

export function resolveAutoScrollDirection(
    pageScrollDirection: number,
    topDistance: number,
    bottomDistance: number,
): number {
    if (pageScrollDirection !== 0) {
        return pageScrollDirection > 0 ? 1 : -1;
    }
    if (bottomDistance < 0) {
        return 1;
    }
    if (topDistance < 0) {
        return -1;
    }
    return 0;
}

export type ScrollTargetParams = {
    topmost: HTMLElement;
    bottommost: HTMLElement;
    currentScrollTop: number;
    tocHeight: number;
    maxScrollTop: number;
    direction: number;
    isPostDetailSidebarToc: boolean;
    config: AutoScrollConfig;
};

export function calculateScrollTarget(params: ScrollTargetParams): number {
    const {
        topmost,
        bottommost,
        currentScrollTop,
        tocHeight,
        maxScrollTop,
        direction,
        isPostDetailSidebarToc,
        config,
    } = params;

    const fadeZone = isPostDetailSidebarToc ? config.fadePx : 0;
    const safeInset = fadeZone + config.safeInsetPx;

    const rawTarget =
        direction > 0
            ? bottommost.offsetTop +
              bottommost.offsetHeight -
              tocHeight +
              safeInset
            : topmost.offsetTop - safeInset;
    const clampedTarget = Math.max(0, Math.min(maxScrollTop, rawTarget));
    const delta = clampedTarget - currentScrollTop;

    const maxStep = Math.max(config.minStepPx, tocHeight * config.stepRatio);
    const nextTop =
        Math.abs(delta) > maxStep
            ? currentScrollTop + Math.sign(delta) * maxStep
            : clampedTarget;
    return Math.max(0, Math.min(maxScrollTop, nextTop));
}

export type AnimateScrollParams = {
    tocEl: HTMLElement;
    targetTop: number;
    minDurationMs: number;
    maxDurationMs: number;
    onFrame: (newScrollTop: number) => void;
    onComplete: (finalTop: number) => void;
    cancelPrev: () => void;
    requestFrame: (cb: (now: number) => void) => number;
    cancelFrame: (id: number) => void;
};

export function createAutoScrollAnimation(params: AnimateScrollParams): number {
    const {
        tocEl,
        targetTop,
        minDurationMs,
        maxDurationMs,
        onFrame,
        onComplete,
        requestFrame,
    } = params;

    const startTop = tocEl.scrollTop;
    const distance = targetTop - startTop;
    if (Math.abs(distance) < 1) {
        return -1;
    }

    params.cancelPrev();
    const duration = Math.max(
        minDurationMs,
        Math.min(maxDurationMs, Math.abs(distance) * 1.6),
    );
    const startTime = performance.now();
    const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

    const step = (now: number): void => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = easeOutCubic(progress);
        const newScrollTop = startTop + distance * eased;
        onFrame(newScrollTop);

        if (progress < 1) {
            requestFrame(step);
            return;
        }

        onComplete(targetTop);
    };

    requestFrame(step);
    return duration;
}

export type TocListenerTarget = {
    tocEl: HTMLElement;
    handleAnchorClick: (e: Event) => void;
    handleTocScroll: () => void;
    handleTocPointerIntent: () => void;
    handleTocKeydown: (e: KeyboardEvent) => void;
    handleWindowScroll: () => void;
    handleWindowResize: () => void;
};

export function bindTocListeners(target: TocListenerTarget): void {
    const { tocEl } = target;

    tocEl.removeEventListener("click", target.handleAnchorClick, true);
    tocEl.addEventListener("click", target.handleAnchorClick, true);

    tocEl.removeEventListener("scroll", target.handleTocScroll);
    tocEl.addEventListener("scroll", target.handleTocScroll, { passive: true });

    tocEl.removeEventListener("wheel", target.handleTocPointerIntent);
    tocEl.addEventListener("wheel", target.handleTocPointerIntent, {
        passive: true,
    });

    tocEl.removeEventListener("touchmove", target.handleTocPointerIntent);
    tocEl.addEventListener("touchmove", target.handleTocPointerIntent, {
        passive: true,
    });

    tocEl.removeEventListener("keydown", target.handleTocKeydown);
    tocEl.addEventListener("keydown", target.handleTocKeydown);

    window.removeEventListener("scroll", target.handleWindowScroll);
    window.addEventListener("scroll", target.handleWindowScroll, {
        passive: true,
    });

    window.removeEventListener("resize", target.handleWindowResize);
    window.addEventListener("resize", target.handleWindowResize, {
        passive: true,
    });
}

export function unbindTocListeners(target: TocListenerTarget): void {
    const { tocEl } = target;
    tocEl.removeEventListener("click", target.handleAnchorClick, true);
    tocEl.removeEventListener("scroll", target.handleTocScroll);
    tocEl.removeEventListener("wheel", target.handleTocPointerIntent);
    tocEl.removeEventListener("touchmove", target.handleTocPointerIntent);
    tocEl.removeEventListener("keydown", target.handleTocKeydown);
    window.removeEventListener("scroll", target.handleWindowScroll);
    window.removeEventListener("resize", target.handleWindowResize);
}

export type ActiveRangeResult = { min: number; max: number };

export function resolveActiveRange(
    active: boolean[],
    tocEntries: HTMLAnchorElement[],
    visibleClass: string,
): ActiveRangeResult {
    let i = active.length - 1;
    let min = active.length - 1;
    let max = -1;

    while (i >= 0 && !active[i]) {
        tocEntries[i]?.classList.remove(visibleClass);
        i -= 1;
    }
    while (i >= 0 && active[i]) {
        tocEntries[i]?.classList.add(visibleClass);
        min = Math.min(min, i);
        max = Math.max(max, i);
        i -= 1;
    }
    while (i >= 0) {
        tocEntries[i]?.classList.remove(visibleClass);
        i -= 1;
    }
    return { min, max };
}

export type ActiveIndicatorParams = {
    min: number;
    max: number;
    tocEl: HTMLElement | null;
    tocEntries: HTMLAnchorElement[];
    activeIndicator: HTMLElement | null;
};

export function updateActiveIndicator(params: ActiveIndicatorParams): void {
    const { min, max, tocEl, tocEntries, activeIndicator } = params;
    if (min > max) {
        activeIndicator?.setAttribute("style", "opacity: 0");
        return;
    }

    const parentOffset = tocEl?.getBoundingClientRect().top ?? 0;
    const scrollOffset = tocEl?.scrollTop ?? 0;
    const minEntry = tocEntries[min];
    const maxEntry = tocEntries[max];
    if (!minEntry || !maxEntry) {
        return;
    }

    const top =
        minEntry.getBoundingClientRect().top - parentOffset + scrollOffset;
    const bottom =
        maxEntry.getBoundingClientRect().bottom - parentOffset + scrollOffset;
    activeIndicator?.setAttribute(
        "style",
        `top: ${top}px; height: ${bottom - top}px`,
    );
}
