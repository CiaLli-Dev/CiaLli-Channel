import {
    collectMarkdownHeadings,
    resolveMarkdownRoot,
} from "@/utils/markdown-toc";
import { scrollElementBelowTocBaseline } from "@/utils/hash-scroll";
import { getTocBaselineOffset } from "@/utils/toc-offset";

type RuntimeWindow = Window &
    typeof globalThis & {
        __floatingTocController?: FloatingTOCController;
        __floatingTocLifecycleBound?: boolean;
        floatingTOCInit?: () => void;
    };

type FloatingHeading = {
    id: string;
    text: string;
    level: number;
    element: HTMLElement;
};

const JAPANESE_KATAKANA_BADGES = [
    "ア",
    "イ",
    "ウ",
    "エ",
    "オ",
    "カ",
    "キ",
    "ク",
    "ケ",
    "コ",
    "サ",
    "シ",
    "ス",
    "セ",
    "ソ",
    "タ",
    "チ",
    "ツ",
    "テ",
    "ト",
    "ナ",
    "ニ",
    "ヌ",
    "ネ",
    "ノ",
    "ハ",
    "ヒ",
    "フ",
    "ヘ",
    "ホ",
];

function escapeHtml(raw: string): string {
    return raw
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

class FloatingTOCController {
    private btn: HTMLElement | null = null;
    private panel: HTMLElement | null = null;
    private content: HTMLElement | null = null;
    private wrapper: HTMLElement | null = null;
    private observedRoot: HTMLElement | null = null;
    private mutationObserver: MutationObserver | null = null;
    private headings: FloatingHeading[] = [];
    private isOpen = false;

    private readonly onScroll = () => {
        this.updateProgress();
        this.updateActiveHeading();
    };

    private readonly onResize = () => {
        this.updateActiveHeading();
        this.updateProgress();
    };

    private readonly onButtonClick = (event: Event) => {
        event.stopPropagation();
        this.toggle();
    };

    private readonly onDocumentClick = (event: Event) => {
        if (!this.isOpen) {
            return;
        }
        if (!this.wrapper?.contains(event.target as Node)) {
            this.close();
        }
    };

    private readonly onContentClick = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const link = target.closest<HTMLAnchorElement>(
            ".floating-toc-item[href^='#']",
        );
        if (!link) {
            return;
        }

        event.preventDefault();
        const id = decodeURIComponent(link.hash.slice(1));
        const heading = document.getElementById(id);
        if (!heading) {
            return;
        }

        scrollElementBelowTocBaseline(heading, { behavior: "smooth" });
        this.close();
    };

    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && this.isOpen) {
            this.close();
        }
    };

    constructor() {
        if (!this.bindElements()) {
            return;
        }
        this.bindEvents();
        this.regenerate();
        this.observeContent();
        this.updateProgress();
    }

    private bindElements(): boolean {
        this.wrapper = document.querySelector<HTMLElement>(
            ".floating-toc-wrapper",
        );
        if (!this.wrapper) {
            return false;
        }

        this.btn = this.wrapper.querySelector<HTMLElement>("#floating-toc-btn");
        this.panel = this.wrapper.querySelector<HTMLElement>(
            "#floating-toc-panel",
        );
        this.content = this.wrapper.querySelector<HTMLElement>(
            "#floating-toc-content",
        );

        return Boolean(this.btn && this.panel && this.content);
    }

    private bindEvents(): void {
        window.addEventListener("scroll", this.onScroll, { passive: true });
        window.addEventListener("resize", this.onResize, { passive: true });
        this.btn?.addEventListener("click", this.onButtonClick);
        document.addEventListener("click", this.onDocumentClick);
        document.addEventListener("keydown", this.onKeyDown);
        this.content?.addEventListener("click", this.onContentClick);
    }

    private unbindEvents(): void {
        window.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
        this.btn?.removeEventListener("click", this.onButtonClick);
        document.removeEventListener("click", this.onDocumentClick);
        document.removeEventListener("keydown", this.onKeyDown);
        this.content?.removeEventListener("click", this.onContentClick);
    }

    private observeContent(): void {
        const markdownRoot = resolveMarkdownRoot();
        if (this.observedRoot === markdownRoot) {
            return;
        }

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        this.observedRoot = markdownRoot;

        if (!markdownRoot) {
            return;
        }

        this.mutationObserver = new MutationObserver(() => {
            this.regenerate();
            this.updateProgress();
        });
        this.mutationObserver.observe(markdownRoot, {
            childList: true,
            subtree: true,
        });
    }

    private getCollectedHeadings(): FloatingHeading[] {
        const maxDepth = Math.max(
            1,
            Number.parseInt(this.wrapper?.dataset.depth || "3", 10) || 3,
        );
        const collected = collectMarkdownHeadings({ maxDepth });
        return collected.map((item) => ({
            id: item.id,
            text: item.text,
            level: item.level,
            element: item.element,
        }));
    }

    private hideWhenNoHeading(): void {
        this.headings = [];
        this.close();
        this.wrapper?.classList.remove("active-toc");
        this.wrapper?.classList.add("no-toc");
        if (this.content) {
            this.content.innerHTML = "";
        }
    }

    private buildHeadingBadge(level: number, topLevelCount: number): string {
        if (level === 1) {
            const useJapaneseBadge =
                this.wrapper?.dataset.japaneseBadge === "true";
            const badgeText =
                useJapaneseBadge &&
                topLevelCount - 1 < JAPANESE_KATAKANA_BADGES.length
                    ? JAPANESE_KATAKANA_BADGES[topLevelCount - 1]
                    : String(topLevelCount);
            return `<span class="floating-toc-badge">${badgeText}</span>`;
        }

        if (level === 2) {
            return '<span class="floating-toc-dot"></span>';
        }

        return '<span class="floating-toc-dot-small"></span>';
    }

    regenerate(): void {
        if (!this.wrapper || !this.content) {
            return;
        }

        this.headings = this.getCollectedHeadings();
        if (this.headings.length === 0) {
            this.hideWhenNoHeading();
            return;
        }

        this.wrapper.classList.remove("no-toc");
        this.wrapper.classList.add("active-toc");

        let levelOneCount = 0;
        this.content.innerHTML = this.headings
            .map((heading) => {
                if (heading.level === 1) {
                    levelOneCount += 1;
                }
                const indent = heading.level - 1;
                const badge = this.buildHeadingBadge(
                    heading.level,
                    levelOneCount,
                );
                const safeText = escapeHtml(heading.text);
                const safeId = encodeURIComponent(heading.id);
                return `<a href="#${safeId}" class="floating-toc-item" style="padding-left: ${0.5 + indent}rem" data-level="${heading.level - 1}">${badge}<span class="floating-toc-text">${safeText}</span></a>`;
            })
            .join("");
        this.updateActiveHeading();
    }

    private updateProgress(): void {
        if (!this.btn) {
            return;
        }

        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight =
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight;
        const scrollPercent = docHeight > 0 ? scrollTop / docHeight : 0;

        const circle = this.btn.querySelector<SVGCircleElement>(
            ".progress-ring-circle",
        );
        if (!circle) {
            return;
        }

        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        const offset = Math.max(
            0,
            Math.min(
                circumference,
                circumference - scrollPercent * circumference,
            ),
        );
        circle.style.strokeDashoffset = offset.toString();
    }

    private updateActiveHeading(): void {
        if (!this.content || this.headings.length === 0) {
            return;
        }

        const scrollY = window.scrollY;
        const baselineY = scrollY + getTocBaselineOffset();

        let activeIndex = -1;
        for (let i = 0; i < this.headings.length; i += 1) {
            const heading = this.headings[i];
            const headingTop =
                heading.element.getBoundingClientRect().top + scrollY;
            if (headingTop <= baselineY) {
                activeIndex = i;
            } else {
                break;
            }
        }

        const links = Array.from(
            this.content.querySelectorAll<HTMLElement>(".floating-toc-item"),
        );
        links.forEach((link, index) => {
            const isActive = index === activeIndex;
            link.classList.toggle("active", isActive);
            if (!isActive || !this.isOpen) {
                return;
            }

            const panelRect = this.content?.getBoundingClientRect();
            const linkRect = link.getBoundingClientRect();
            if (!panelRect) {
                return;
            }
            if (
                linkRect.top < panelRect.top ||
                linkRect.bottom > panelRect.bottom
            ) {
                link.scrollIntoView({ block: "nearest" });
            }
        });
    }

    private toggle(): void {
        if (this.isOpen) {
            this.close();
            return;
        }
        this.open();
    }

    private open(): void {
        this.isOpen = true;
        this.panel?.classList.add("show");
        this.btn?.classList.add("active");
        this.wrapper?.classList.add("active");
    }

    private close(): void {
        this.isOpen = false;
        this.panel?.classList.remove("show");
        this.btn?.classList.remove("active");
        this.wrapper?.classList.remove("active");
    }

    reinit(): void {
        if (!this.wrapper?.isConnected || !this.content?.isConnected) {
            this.destroy();
            if (!this.bindElements()) {
                return;
            }
            this.bindEvents();
        }

        this.observeContent();
        this.regenerate();
        this.updateProgress();
    }

    destroy(): void {
        this.close();
        this.unbindEvents();
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        this.observedRoot = null;
        this.headings = [];
    }
}

const runtimeWindow = window as RuntimeWindow;

function ensureFloatingTOC(): void {
    const wrapper = document.querySelector<HTMLElement>(
        ".floating-toc-wrapper",
    );
    if (!wrapper) {
        runtimeWindow.__floatingTocController?.destroy();
        delete runtimeWindow.__floatingTocController;
        return;
    }

    if (!runtimeWindow.__floatingTocController) {
        runtimeWindow.__floatingTocController = new FloatingTOCController();
        return;
    }

    runtimeWindow.__floatingTocController.reinit();
}

runtimeWindow.floatingTOCInit = ensureFloatingTOC;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureFloatingTOC, {
        once: true,
    });
} else {
    ensureFloatingTOC();
}
