/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
import { scrollElementBelowTocBaseline } from "@/utils/hash-scroll";
import { collectMarkdownHeadings } from "@/utils/markdown-toc";
import { getTocBaselineOffset } from "@/utils/toc-offset";
import { buildTocHtml } from "@/scripts/toc-helpers";
import {
    bindTocListeners,
    unbindTocListeners,
    resolveActiveRange,
    updateActiveIndicator,
} from "@/scripts/toc-scroll-helpers";

class TableOfContents extends HTMLElement {
    private static readonly TOC_FADE_HEIGHT_PX = 44;
    private static readonly AUTO_SCROLL_TRIGGER_PADDING_PX = 12;
    private static readonly AUTO_SCROLL_SAFE_INSET_PX = 12;
    private static readonly AUTO_SCROLL_MIN_DURATION_MS = 320;
    private static readonly AUTO_SCROLL_MAX_DURATION_MS = 620;
    private static readonly AUTO_SCROLL_STEP_RATIO = 0.38;
    private static readonly AUTO_SCROLL_MIN_STEP_PX = 96;

    tocEl: HTMLElement | null = null;
    visibleClass = "visible";
    observer: IntersectionObserver;
    anchorNavTarget: HTMLElement | null = null;
    headingIdxMap = new Map<string, number>();
    headings: HTMLElement[] = [];
    sections: HTMLElement[] = [];
    tocEntries: HTMLAnchorElement[] = [];
    active: boolean[] = [];
    activeIndicator: HTMLElement | null = null;
    initTimeout: number | null = null;
    programmaticScrollTimeout: number | null = null;
    autoScrollAnimationFrame: number | null = null;
    isPostDetailSidebarToc = false;
    manualBrowseMode = false;
    isProgrammaticScroll = false;
    lastWindowScrollY = 0;
    pageScrollDirection = 0;

    constructor() {
        super();
        this.observer = this.createObserver();
    }

    private createObserver = (): IntersectionObserver => {
        const baselineOffset = getTocBaselineOffset();
        return new IntersectionObserver(this.markVisibleSection, {
            threshold: 0,
            rootMargin: `-${baselineOffset}px 0px 0px 0px`,
        });
    };

    private clearInitTimeout = (): void => {
        if (this.initTimeout !== null) {
            window.clearTimeout(this.initTimeout);
            this.initTimeout = null;
        }
    };

    private clearProgrammaticScrollTimeout = (): void => {
        if (this.programmaticScrollTimeout !== null) {
            window.clearTimeout(this.programmaticScrollTimeout);
            this.programmaticScrollTimeout = null;
        }
    };

    private markProgrammaticScroll = (durationMs = 900): void => {
        this.isProgrammaticScroll = true;
        this.clearProgrammaticScrollTimeout();
        this.programmaticScrollTimeout = window.setTimeout(
            () => {
                this.isProgrammaticScroll = false;
                this.programmaticScrollTimeout = null;
            },
            Math.max(120, durationMs),
        );
    };

    private clearAutoScrollAnimation = (): void => {
        if (this.autoScrollAnimationFrame !== null) {
            window.cancelAnimationFrame(this.autoScrollAnimationFrame);
            this.autoScrollAnimationFrame = null;
        }
    };

    private interruptProgrammaticScroll = (): void => {
        this.clearAutoScrollAnimation();
        this.clearProgrammaticScrollTimeout();
        this.isProgrammaticScroll = false;
    };

    private setManualBrowseMode = (active: boolean): void => {
        this.manualBrowseMode = active;
        this.dataset.manualBrowse = active ? "1" : "0";
    };

    private cleanupObservers = (): void => {
        this.sections.forEach((section) => this.observer.unobserve(section));
        this.observer.disconnect();
    };

    private unbindInteractionListeners = (): void => {
        if (!this.tocEl) {
            return;
        }
        unbindTocListeners({
            tocEl: this.tocEl,
            handleAnchorClick: this.handleAnchorClick,
            handleTocScroll: this.handleTocScroll,
            handleTocPointerIntent: this.handleTocPointerIntent,
            handleTocKeydown: this.handleTocKeydown,
            handleWindowScroll: this.handleWindowScroll,
            handleWindowResize: this.handleWindowResize,
        });
    };

    private bindInteractionListeners = (): void => {
        if (!this.tocEl) {
            return;
        }
        bindTocListeners({
            tocEl: this.tocEl,
            handleAnchorClick: this.handleAnchorClick,
            handleTocScroll: this.handleTocScroll,
            handleTocPointerIntent: this.handleTocPointerIntent,
            handleTocKeydown: this.handleTocKeydown,
            handleWindowScroll: this.handleWindowScroll,
            handleWindowResize: this.handleWindowResize,
        });
    };

    private syncOverflowMaskState = (): void => {
        if (!this.tocEl || !this.isPostDetailSidebarToc) {
            this.dataset.fadeTop = "0";
            this.dataset.fadeBottom = "0";
            this.dataset.overflowing = "0";
            return;
        }

        const { scrollTop, scrollHeight, clientHeight } = this.tocEl;
        const overflowGap = scrollHeight - clientHeight;
        const hasOverflow = overflowGap > 1;
        const canScrollUp = scrollTop > 1;
        const canScrollDown = scrollTop < overflowGap - 1;

        this.dataset.overflowing = hasOverflow ? "1" : "0";
        this.dataset.fadeTop = hasOverflow && canScrollUp ? "1" : "0";
        this.dataset.fadeBottom = hasOverflow && canScrollDown ? "1" : "0";
    };

    private resetState = (): void => {
        this.cleanupObservers();
        this.unbindInteractionListeners();
        this.clearAutoScrollAnimation();
        this.clearProgrammaticScrollTimeout();
        this.anchorNavTarget = null;
        this.headingIdxMap.clear();
        this.headings = [];
        this.sections = [];
        this.tocEntries = [];
        this.active = [];
        this.activeIndicator = null;
        this.isProgrammaticScroll = false;
        this.lastWindowScrollY = 0;
        this.pageScrollDirection = 0;
        this.dataset.postDetailSidebar = "0";
        this.setManualBrowseMode(false);
        this.isPostDetailSidebarToc = false;
        this.syncOverflowMaskState();
    };

    private scheduleInit = (): void => {
        this.clearInitTimeout();
        this.initTimeout = window.setTimeout(() => {
            this.init();
        }, 160);
    };

    markVisibleSection = (entries: IntersectionObserverEntry[]): void => {
        entries.forEach((entry) => {
            const id = entry.target.firstElementChild?.getAttribute("id");
            const idx = id ? this.headingIdxMap.get(id) : undefined;
            if (idx !== undefined) {
                this.active[idx] = entry.isIntersecting;
            }

            if (
                entry.isIntersecting &&
                this.anchorNavTarget === entry.target.firstElementChild
            ) {
                this.anchorNavTarget = null;
            }
        });

        if (!this.active.includes(true)) {
            this.fallback();
        }
        this.update();
    };

    private resolveActiveRange = (): { min: number; max: number } => {
        return resolveActiveRange(
            this.active,
            this.tocEntries,
            this.visibleClass,
        );
    };

    private updateActiveIndicator = (min: number, max: number): void => {
        updateActiveIndicator({
            min,
            max,
            tocEl: this.tocEl,
            tocEntries: this.tocEntries,
            activeIndicator: this.activeIndicator,
        });
    };

    toggleActiveHeading = (): void => {
        const { min, max } = this.resolveActiveRange();
        this.updateActiveIndicator(min, max);
    };

    private resolveAutoScrollDirection = (
        topDistance: number,
        bottomDistance: number,
    ): number => {
        if (this.pageScrollDirection !== 0) {
            return this.pageScrollDirection > 0 ? 1 : -1;
        }
        if (bottomDistance < 0) {
            return 1;
        }
        if (topDistance < 0) {
            return -1;
        }
        return 0;
    };

    private animateAutoScrollTo = (targetTop: number): void => {
        if (!this.tocEl) {
            return;
        }
        const startTop = this.tocEl.scrollTop;
        const distance = targetTop - startTop;
        if (Math.abs(distance) < 1) {
            return;
        }

        this.clearAutoScrollAnimation();
        const duration = Math.max(
            TableOfContents.AUTO_SCROLL_MIN_DURATION_MS,
            Math.min(
                TableOfContents.AUTO_SCROLL_MAX_DURATION_MS,
                Math.abs(distance) * 1.6,
            ),
        );
        this.markProgrammaticScroll(duration + 160);

        const startTime = performance.now();
        const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
        const step = (now: number): void => {
            if (!this.tocEl) {
                this.autoScrollAnimationFrame = null;
                return;
            }
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = easeOutCubic(progress);
            this.tocEl.scrollTop = startTop + distance * eased;
            this.syncOverflowMaskState();

            if (progress < 1) {
                this.autoScrollAnimationFrame =
                    window.requestAnimationFrame(step);
                return;
            }

            this.tocEl.scrollTop = targetTop;
            this.syncOverflowMaskState();
            this.autoScrollAnimationFrame = null;
        };

        this.autoScrollAnimationFrame = window.requestAnimationFrame(step);
    };

    private calculateScrollTarget = (
        topmost: HTMLElement,
        bottommost: HTMLElement,
        currentScrollTop: number,
        tocHeight: number,
        maxScrollTop: number,
        direction: number,
    ): number => {
        const fadeZone = this.isPostDetailSidebarToc
            ? TableOfContents.TOC_FADE_HEIGHT_PX
            : 0;
        const safeInset = fadeZone + TableOfContents.AUTO_SCROLL_SAFE_INSET_PX;

        const rawTarget =
            direction > 0
                ? bottommost.offsetTop +
                  bottommost.offsetHeight -
                  tocHeight +
                  safeInset
                : topmost.offsetTop - safeInset;
        const clampedTarget = Math.max(0, Math.min(maxScrollTop, rawTarget));
        const delta = clampedTarget - currentScrollTop;

        const maxStep = Math.max(
            TableOfContents.AUTO_SCROLL_MIN_STEP_PX,
            tocHeight * TableOfContents.AUTO_SCROLL_STEP_RATIO,
        );
        const nextTop =
            Math.abs(delta) > maxStep
                ? currentScrollTop + Math.sign(delta) * maxStep
                : clampedTarget;
        return Math.max(0, Math.min(maxScrollTop, nextTop));
    };

    private applyAutoScrollIfNeeded = (
        topmost: HTMLDivElement,
        bottommost: HTMLDivElement,
        topDistance: number,
        bottomDistance: number,
        currentScrollTop: number,
        tocHeight: number,
        maxScrollTop: number,
    ): void => {
        const direction = this.resolveAutoScrollDirection(
            topDistance,
            bottomDistance,
        );
        if (direction === 0) {
            return;
        }
        const fadeZone = this.isPostDetailSidebarToc
            ? TableOfContents.TOC_FADE_HEIGHT_PX
            : 0;
        const triggerZone =
            fadeZone + TableOfContents.AUTO_SCROLL_TRIGGER_PADDING_PX;
        if (direction > 0 && bottomDistance > triggerZone) {
            return;
        }
        if (direction < 0 && topDistance > triggerZone) {
            return;
        }
        const scrollTarget = this.calculateScrollTarget(
            topmost,
            bottommost,
            currentScrollTop,
            tocHeight,
            maxScrollTop,
            direction,
        );
        if (Math.abs(scrollTarget - currentScrollTop) < 1) {
            return;
        }
        this.animateAutoScrollTo(scrollTarget);
    };

    scrollToActiveHeading = (): void => {
        if (
            this.anchorNavTarget ||
            !this.tocEl ||
            this.manualBrowseMode ||
            this.isProgrammaticScroll
        ) {
            return;
        }
        const activeHeadings = this.querySelectorAll<HTMLDivElement>(
            `.${this.visibleClass}`,
        );
        if (activeHeadings.length === 0) {
            return;
        }
        const topmost = activeHeadings[0];
        const bottommost = activeHeadings[activeHeadings.length - 1];
        const tocHeight = this.tocEl.clientHeight;
        const currentScrollTop = this.tocEl.scrollTop;
        const maxScrollTop = Math.max(0, this.tocEl.scrollHeight - tocHeight);
        if (maxScrollTop <= 1) {
            return;
        }
        const topDistance = topmost.offsetTop - currentScrollTop;
        const bottomDistance =
            tocHeight -
            (bottommost.offsetTop + bottommost.offsetHeight - currentScrollTop);
        this.applyAutoScrollIfNeeded(
            topmost,
            bottommost,
            topDistance,
            bottomDistance,
            currentScrollTop,
            tocHeight,
            maxScrollTop,
        );
    };

    update = (): void => {
        requestAnimationFrame(() => {
            this.toggleActiveHeading();
            this.scrollToActiveHeading();
            this.syncOverflowMaskState();
        });
    };

    fallback = (): void => {
        if (this.sections.length === 0) {
            return;
        }

        const baselineOffset = getTocBaselineOffset();

        for (let i = 0; i < this.sections.length; i += 1) {
            const offsetTop = this.sections[i].getBoundingClientRect().top;
            const offsetBottom =
                this.sections[i].getBoundingClientRect().bottom;
            const inViewport =
                this.isInRange(offsetTop, baselineOffset, window.innerHeight) ||
                this.isInRange(
                    offsetBottom,
                    baselineOffset,
                    window.innerHeight,
                ) ||
                (offsetTop < baselineOffset &&
                    offsetBottom > window.innerHeight);

            if (inViewport) {
                this.active[i] = true;
            } else if (offsetTop > window.innerHeight) {
                break;
            }
        }
    };

    handleAnchorClick = (event: Event): void => {
        const anchor = event
            .composedPath()
            .find((element) => element instanceof HTMLAnchorElement);
        if (!(anchor instanceof HTMLAnchorElement)) {
            return;
        }

        event.preventDefault();

        const id = decodeURIComponent(anchor.hash.substring(1));
        const targetElement = document.getElementById(id);
        if (targetElement) {
            scrollElementBelowTocBaseline(targetElement, {
                behavior: "smooth",
            });
        }

        const idx = this.headingIdxMap.get(id);
        this.anchorNavTarget =
            typeof idx === "number" ? this.headings[idx] : null;
        this.setManualBrowseMode(false);
        this.syncOverflowMaskState();
    };

    private handleTocScroll = (): void => {
        this.syncOverflowMaskState();
        if (!this.isPostDetailSidebarToc || this.isProgrammaticScroll) {
            return;
        }
        this.setManualBrowseMode(true);
    };

    private handleTocPointerIntent = (): void => {
        if (!this.isPostDetailSidebarToc) {
            return;
        }
        // 用户主动滚动 TOC 时，先暂停自动跟随
        this.interruptProgrammaticScroll();
        this.setManualBrowseMode(true);
    };

    private handleTocKeydown = (event: KeyboardEvent): void => {
        if (!this.isPostDetailSidebarToc) {
            return;
        }
        const navKeys = new Set([
            "ArrowUp",
            "ArrowDown",
            "PageUp",
            "PageDown",
            "Home",
            "End",
            " ",
            "Spacebar",
        ]);
        if (navKeys.has(event.key)) {
            this.interruptProgrammaticScroll();
            this.setManualBrowseMode(true);
        }
    };

    private handleWindowScroll = (): void => {
        if (!this.isPostDetailSidebarToc) {
            return;
        }
        const nextScrollY =
            window.scrollY || document.documentElement.scrollTop;
        const delta = nextScrollY - this.lastWindowScrollY;
        const hasMoved = Math.abs(delta) > 0.5;
        if (hasMoved) {
            this.pageScrollDirection = delta > 0 ? 1 : -1;
        }
        this.lastWindowScrollY = nextScrollY;

        if (hasMoved && this.manualBrowseMode) {
            this.setManualBrowseMode(false);
        }
    };

    private handleWindowResize = (): void => {
        this.syncOverflowMaskState();
    };

    isInRange(value: number, min: number, max: number): boolean {
        return min < value && value < max;
    }

    connectedCallback(): void {
        this.scheduleInit();
    }

    private buildSectionMappings(): void {
        const nextSections: HTMLElement[] = [];
        const nextHeadings: HTMLElement[] = [];

        this.tocEntries.forEach((entry) => {
            const id = decodeURIComponent(entry.hash.substring(1));
            const heading = document.getElementById(id);
            if (!(heading instanceof HTMLElement)) {
                return;
            }
            const section =
                heading.parentElement instanceof HTMLElement
                    ? heading.parentElement
                    : heading;
            this.headingIdxMap.set(id, nextHeadings.length);
            nextHeadings.push(heading);
            nextSections.push(section);
        });

        this.headings = nextHeadings;
        this.sections = nextSections;
    }

    init(): void {
        this.clearInitTimeout();
        this.resetState();
        this.observer = this.createObserver();

        this.tocEl = this;
        this.isPostDetailSidebarToc = Boolean(
            this.closest<HTMLElement>("[data-post-detail-toc='1']"),
        );
        this.dataset.postDetailSidebar = this.isPostDetailSidebarToc
            ? "1"
            : "0";
        this.lastWindowScrollY =
            window.scrollY || document.documentElement.scrollTop;
        this.pageScrollDirection = 0;
        this.bindInteractionListeners();

        this.regenerateTOC();
        this.activeIndicator = this.querySelector("#active-indicator");
        this.tocEntries = Array.from(
            this.querySelectorAll<HTMLAnchorElement>("a[href^='#']"),
        );
        if (this.tocEntries.length === 0) {
            return;
        }

        this.buildSectionMappings();
        this.active = new Array(this.tocEntries.length).fill(false);
        this.sections.forEach((section) => this.observer.observe(section));

        this.fallback();
        this.update();
        this.syncOverflowMaskState();
    }

    regenerateTOC(retryCount = 0): void {
        const runtimeSettings = window.__CIALLI_RUNTIME_SETTINGS__;
        const maxLevel = runtimeSettings?.settings.toc.depth ?? 3;
        const useJapaneseBadge =
            runtimeSettings?.settings.toc.useJapaneseBadge ?? false;
        const headings = collectMarkdownHeadings({ maxDepth: maxLevel });

        if (headings.length === 0) {
            if (retryCount < 3) {
                window.setTimeout(
                    () => this.regenerateTOC(retryCount + 1),
                    120,
                );
                return;
            }
            this.style.display = "none";
            this.innerHTML = "";
            delete this.dataset.loaded;
            this.syncOverflowMaskState();
            return;
        }

        this.style.display = "block";
        const tocHTML = buildTocHtml(headings, useJapaneseBadge);
        this.innerHTML = `${tocHTML}<div id="active-indicator" style="opacity: 0" class="-z-10 absolute bg-(--toc-btn-hover) left-0 right-0 rounded-xl transition-all group-hover:bg-transparent border-2 border-(--toc-btn-hover) group-hover:border-(--toc-btn-active) border-dashed"></div>`;
        this.dataset.loaded = "true";
        this.syncOverflowMaskState();
    }

    disconnectedCallback(): void {
        this.clearInitTimeout();
        this.clearAutoScrollAnimation();
        this.clearProgrammaticScrollTimeout();
        this.cleanupObservers();
        this.unbindInteractionListeners();
    }
}

if (!customElements.get("table-of-contents")) {
    customElements.define("table-of-contents", TableOfContents);
}
