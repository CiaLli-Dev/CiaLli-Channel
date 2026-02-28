import { setupPageInit } from "@utils/page-init";

type MermaidTheme = "default" | "dark";

type MermaidRenderResult = {
    svg: string;
};

type MermaidApi = {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, code: string) => Promise<MermaidRenderResult>;
};

type MermaidRuntimeWindow = Window & {
    mermaid?: MermaidApi;
    renderMermaidDiagrams?: () => Promise<void>;
    __mermaidRuntimeInitialized?: boolean;
    __mermaidLoadPromise?: Promise<MermaidApi>;
    __mermaidThemeObserver?: MutationObserver;
};

const PRIMARY_CDN =
    "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
const FALLBACK_CDN = "https://unpkg.com/mermaid@11/dist/mermaid.min.js";

let renderTimer: number | null = null;
let isRendering = false;
let renderQueued = false;
let renderSequence = 0;
let lastTheme: MermaidTheme | null = null;
const MAX_DEFERRED_RENDER_ATTEMPTS = 12;
const MERMAID_DEFER_COUNT_ATTR = "data-mermaid-defer-count";
const ACTIVE_TRANSITION_ROOT_CLASSES = [
    "layout-banner-to-spec-transition",
    "layout-banner-to-spec-transition-preparing",
    "layout-banner-to-spec-transition-active",
    "layout-spec-to-banner-transition",
];

const pageWindow = window as MermaidRuntimeWindow;

const getTheme = (): MermaidTheme =>
    document.documentElement.classList.contains("dark") ? "dark" : "default";

const normalizeCode = (code: string): string =>
    code.replace(/\r\n?/g, "\n").trim();

const hashCode = (code: string): string => {
    let hash = 0;
    for (let index = 0; index < code.length; index += 1) {
        hash = (hash * 31 + code.charCodeAt(index)) | 0;
    }
    return `${code.length}:${Math.abs(hash)}`;
};

const isElementLayoutReady = (element: HTMLElement): boolean => {
    if (!element.isConnected) {
        return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
        return false;
    }

    const rect = element.getBoundingClientRect();
    // Mermaid 在宽度为 0 的容器中渲染时可能产生负尺寸 SVG 属性，需等待布局稳定后再渲染。
    return rect.width > 1;
};

const getDeferredRenderCount = (element: HTMLElement): number => {
    const rawValue = element.getAttribute(MERMAID_DEFER_COUNT_ATTR);
    if (!rawValue) {
        return 0;
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const isLayoutTransitionActive = (): boolean =>
    ACTIVE_TRANSITION_ROOT_CLASSES.some((className) =>
        document.documentElement.classList.contains(className),
    );

const scheduleRender = (delay = 0): void => {
    if (renderTimer !== null) {
        window.clearTimeout(renderTimer);
    }
    renderTimer = window.setTimeout(() => {
        renderTimer = null;
        void renderMermaidDiagrams();
    }, delay);
};

const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
        const selector = `script[data-mermaid-src="${src}"]`;
        const existing = document.querySelector(selector);
        if (existing instanceof HTMLScriptElement) {
            if (existing.dataset.loaded === "true") {
                resolve();
                return;
            }
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener(
                "error",
                () =>
                    reject(new Error(`Failed to load Mermaid script: ${src}`)),
                { once: true },
            );
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.dataset.mermaidSrc = src;
        script.onload = () => {
            script.dataset.loaded = "true";
            resolve();
        };
        script.onerror = () =>
            reject(new Error(`Failed to load Mermaid script: ${src}`));
        document.head.appendChild(script);
    });

const getMermaid = async (): Promise<MermaidApi> => {
    if (pageWindow.mermaid && typeof pageWindow.mermaid.render === "function") {
        return pageWindow.mermaid;
    }

    if (!pageWindow.__mermaidLoadPromise) {
        pageWindow.__mermaidLoadPromise = (async () => {
            try {
                await loadScript(PRIMARY_CDN);
            } catch (error) {
                console.warn(
                    "[mermaid] primary CDN failed, fallback to unpkg:",
                    error,
                );
                await loadScript(FALLBACK_CDN);
            }

            if (
                !pageWindow.mermaid ||
                typeof pageWindow.mermaid.initialize !== "function" ||
                typeof pageWindow.mermaid.render !== "function"
            ) {
                throw new Error(
                    "Mermaid library loaded but API is unavailable",
                );
            }

            return pageWindow.mermaid;
        })();
    }

    return pageWindow.__mermaidLoadPromise;
};

const renderOne = async (
    mermaid: MermaidApi,
    element: HTMLElement,
    theme: MermaidTheme,
    force: boolean,
): Promise<void> => {
    const code = normalizeCode(
        String(element.getAttribute("data-mermaid-code") || ""),
    );
    if (!code) {
        return;
    }

    const codeHash = hashCode(code);
    const renderedHash = element.getAttribute("data-mermaid-rendered-hash");
    const renderedTheme = element.getAttribute("data-mermaid-rendered-theme");
    const hasSvg = Boolean(element.querySelector("svg"));

    if (
        !force &&
        hasSvg &&
        renderedHash === codeHash &&
        renderedTheme === theme
    ) {
        return;
    }

    element.setAttribute("data-mermaid-rendering", "true");
    element.innerHTML =
        '<div class="mermaid-loading">Rendering diagram...</div>';

    try {
        const renderId = `mermaid-${Date.now()}-${renderSequence}`;
        renderSequence += 1;
        const { svg } = await mermaid.render(renderId, code);

        element.innerHTML = svg;
        const svgElement = element.querySelector("svg");
        if (svgElement instanceof SVGElement) {
            svgElement.setAttribute("width", "100%");
            svgElement.removeAttribute("height");
            svgElement.style.maxWidth = "100%";
            svgElement.style.height = "auto";
        }

        element.setAttribute("data-mermaid-rendered-hash", codeHash);
        element.setAttribute("data-mermaid-rendered-theme", theme);
        element.removeAttribute(MERMAID_DEFER_COUNT_ATTR);
    } catch (error) {
        console.error("[mermaid] failed to render diagram:", error);
        element.innerHTML =
            '<div class="mermaid-error"><p>Failed to render Mermaid diagram.</p></div>';
        element.removeAttribute("data-mermaid-rendered-hash");
        element.removeAttribute("data-mermaid-rendered-theme");
    } finally {
        element.removeAttribute("data-mermaid-rendering");
    }
};

const renderMermaidDiagrams = async (force = false): Promise<void> => {
    if (isRendering) {
        renderQueued = true;
        return;
    }

    // Banner-to-spec 转场期间优先保证位移动画流畅，Mermaid 渲染延后执行。
    if (isLayoutTransitionActive()) {
        scheduleRender(220);
        return;
    }

    const rawElements = Array.from(
        document.querySelectorAll<HTMLElement>(".mermaid[data-mermaid-code]"),
    );
    if (rawElements.length === 0) {
        return;
    }

    const elements: HTMLElement[] = [];
    let hasDeferredElements = false;
    for (const element of rawElements) {
        if (isElementLayoutReady(element)) {
            elements.push(element);
            element.removeAttribute(MERMAID_DEFER_COUNT_ATTR);
            continue;
        }

        const deferredCount = getDeferredRenderCount(element) + 1;
        element.setAttribute(MERMAID_DEFER_COUNT_ATTR, String(deferredCount));
        if (deferredCount < MAX_DEFERRED_RENDER_ATTEMPTS) {
            hasDeferredElements = true;
        }
    }

    if (elements.length === 0) {
        if (hasDeferredElements) {
            scheduleRender(160);
        }
        return;
    }

    isRendering = true;

    try {
        const mermaid = await getMermaid();
        const theme = getTheme();
        const themeChanged = lastTheme !== null && lastTheme !== theme;
        lastTheme = theme;

        mermaid.initialize({
            startOnLoad: false,
            theme,
            securityLevel: "loose",
            logLevel: "error",
            themeVariables: {
                fontFamily: "inherit",
                fontSize: "16px",
            },
        });

        const shouldForce = force || themeChanged;
        // 顺序渲染可降低多图并发时的主线程峰值占用，避免转场与排版同时抖动。
        for (const element of elements) {
            await renderOne(mermaid, element, theme, shouldForce);
        }
    } catch (error) {
        console.error("[mermaid] runtime render failed:", error);
    } finally {
        isRendering = false;
        if (hasDeferredElements) {
            scheduleRender(160);
        }
        if (renderQueued) {
            renderQueued = false;
            scheduleRender();
        }
    }
};

const setupThemeObserver = (): void => {
    if (pageWindow.__mermaidThemeObserver) {
        return;
    }

    const observer = new MutationObserver((mutationList) => {
        const hasClassChange = mutationList.some(
            (mutation) =>
                mutation.type === "attributes" &&
                mutation.attributeName === "class",
        );
        if (hasClassChange) {
            scheduleRender(100);
        }
    });

    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
    });
    pageWindow.__mermaidThemeObserver = observer;
};

const bootstrap = (): void => {
    setupThemeObserver();

    setupPageInit({
        key: "mermaid-runtime",
        init: () => {
            scheduleRender(0);
        },
        delay: 50,
        runOnPageShow: true,
    });

    document.addEventListener("cialli:page:loaded", () => {
        scheduleRender(50);
    });

    pageWindow.renderMermaidDiagrams = async () => {
        await renderMermaidDiagrams(true);
    };
};

if (!pageWindow.__mermaidRuntimeInitialized) {
    pageWindow.__mermaidRuntimeInitialized = true;
    bootstrap();
} else {
    pageWindow.renderMermaidDiagrams = async () => {
        await renderMermaidDiagrams(true);
    };
    scheduleRender(0);
}
