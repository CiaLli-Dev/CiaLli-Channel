/**
 * 发布编辑器 Monaco 样式兜底。
 *
 * Astro ClientRouter 在 fallback="swap" 下会替换整个 document，
 * 运行时动态插入到旧文档 head 的 Monaco 样式会随之消失；
 * 但 Vite 运行时仍会记住“该依赖已加载”，导致二次进入时不再补挂。
 * 这里在创建编辑器前按“当前文档”补齐一份稳定样式入口，避免编辑器只剩外层边框。
 */

import monacoEditorStylesheetHref from "@/styles/monaco-editor.css?url";

const FALLBACK_STYLESHEET_ATTR = "data-publish-monaco-stylesheet";
const FALLBACK_STYLESHEET_LOADED_ATTR = "data-publish-monaco-stylesheet-loaded";
const FALLBACK_STYLESHEET_SELECTOR = `link[rel="stylesheet"][${FALLBACK_STYLESHEET_ATTR}="1"]`;
const MONACO_STYLE_MARKERS = [
    ".monaco-editor",
    ".monaco-scrollable-element",
    ".monaco-aria-container",
] as const;

type CssRuleLike = {
    cssText?: string;
    cssRules?: ArrayLike<CssRuleLike>;
    styleSheet?: {
        cssRules?: ArrayLike<CssRuleLike>;
    } | null;
};

type StylesheetLike = {
    cssRules?: ArrayLike<CssRuleLike>;
};

type MonacoThemeStyleElementLike = {
    className?: string;
    textContent?: string | null;
    isConnected: boolean;
    ownerDocument: Document;
};

type MonacoThemeServiceLike = {
    _allCSS: string;
    _globalStyleElement: MonacoThemeStyleElementLike | null;
    _styleElements: MonacoThemeStyleElementLike[];
    registerEditorContainer: (domNode: HTMLElement) => { dispose(): void };
};

type MonacoStandaloneServicesModule = {
    StandaloneServices: {
        get: (serviceId: unknown) => unknown;
    };
};

type MonacoStandaloneThemeModule = {
    IStandaloneThemeService: unknown;
};

function arrayLikeToArray<T>(input: ArrayLike<T> | undefined | null): T[] {
    if (!input) {
        return [];
    }

    const values: T[] = [];
    for (let index = 0; index < input.length; index += 1) {
        const value = input[index];
        if (typeof value !== "undefined") {
            values.push(value);
        }
    }
    return values;
}

function getNestedCssRules(rule: CssRuleLike): ArrayLike<CssRuleLike> | null {
    if (rule.cssRules) {
        return rule.cssRules;
    }
    return rule.styleSheet?.cssRules ?? null;
}

function cssRuleListContainsMonacoStyles(
    ruleList: ArrayLike<CssRuleLike>,
): boolean {
    for (const rule of arrayLikeToArray(ruleList)) {
        const cssText = String(rule.cssText || "");
        if (MONACO_STYLE_MARKERS.some((marker) => cssText.includes(marker))) {
            return true;
        }

        const nestedRules = getNestedCssRules(rule);
        if (nestedRules && cssRuleListContainsMonacoStyles(nestedRules)) {
            return true;
        }
    }
    return false;
}

function stylesheetContainsMonacoStyles(stylesheet: StylesheetLike): boolean {
    try {
        const rules = stylesheet.cssRules;
        if (!rules) {
            return false;
        }
        return cssRuleListContainsMonacoStyles(rules);
    } catch (error) {
        // 兜底：若样式表不可读（例如浏览器限制），跳过即可。
        console.warn("[publish] inspect stylesheet failed:", error);
        return false;
    }
}

function documentHasMonacoStyles(targetDocument: Document): boolean {
    const stylesheets = arrayLikeToArray(targetDocument.styleSheets);
    return stylesheets.some((stylesheet) =>
        stylesheetContainsMonacoStyles(stylesheet as StylesheetLike),
    );
}

function markLinkLoaded(link: HTMLLinkElement): void {
    link.setAttribute(FALLBACK_STYLESHEET_LOADED_ATTR, "true");
}

function isLinkLoaded(link: HTMLLinkElement): boolean {
    return (
        link.getAttribute(FALLBACK_STYLESHEET_LOADED_ATTR) === "true" ||
        link.sheet !== null
    );
}

function waitForLinkLoad(link: HTMLLinkElement): Promise<void> {
    if (isLinkLoaded(link)) {
        markLinkLoaded(link);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const handleLoad = (): void => {
            cleanup();
            markLinkLoaded(link);
            resolve();
        };
        const handleError = (): void => {
            cleanup();
            reject(
                new Error(
                    "[publish] failed to load Monaco fallback stylesheet",
                ),
            );
        };
        const cleanup = (): void => {
            link.removeEventListener("load", handleLoad);
            link.removeEventListener("error", handleError);
        };

        link.addEventListener("load", handleLoad, { once: true });
        link.addEventListener("error", handleError, { once: true });
    });
}

function getFallbackStylesheetLink(
    targetDocument: Document,
): HTMLLinkElement | null {
    const existing = targetDocument.querySelector(FALLBACK_STYLESHEET_SELECTOR);
    return existing instanceof HTMLLinkElement ? existing : null;
}

function getCurrentMonacoColorStyleElement(
    targetDocument: Document,
): MonacoThemeStyleElementLike | null {
    const existing = targetDocument.head?.querySelector("style.monaco-colors");
    if (!existing) {
        return null;
    }
    return existing as MonacoThemeStyleElementLike;
}

function isThemeStyleElementLiveInDocument(
    styleElement: MonacoThemeStyleElementLike | null,
    targetDocument: Document,
): boolean {
    return Boolean(
        styleElement &&
        styleElement.isConnected &&
        styleElement.ownerDocument === targetDocument,
    );
}

function isMonacoThemeServiceLike(
    value: unknown,
): value is MonacoThemeServiceLike {
    if (!value || typeof value !== "object") {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        typeof record._allCSS === "string" &&
        Array.isArray(record._styleElements) &&
        typeof record.registerEditorContainer === "function" &&
        "_globalStyleElement" in record
    );
}

export function restoreDetachedMonacoThemeServiceStyles(
    themeService: MonacoThemeServiceLike,
    monacoHostEl: HTMLElement,
    targetDocument: Document = document,
): void {
    const liveStyleElements = themeService._styleElements.filter(
        (styleElement) =>
            styleElement.isConnected &&
            styleElement.ownerDocument === targetDocument,
    );
    themeService._styleElements = liveStyleElements;

    const currentMonacoColorStyle =
        getCurrentMonacoColorStyleElement(targetDocument);
    const hasLiveGlobalStyle = isThemeStyleElementLiveInDocument(
        themeService._globalStyleElement,
        targetDocument,
    );

    if (hasLiveGlobalStyle && currentMonacoColorStyle) {
        return;
    }

    if (currentMonacoColorStyle) {
        currentMonacoColorStyle.textContent = themeService._allCSS;
        themeService._globalStyleElement = currentMonacoColorStyle;
        if (!themeService._styleElements.includes(currentMonacoColorStyle)) {
            themeService._styleElements.push(currentMonacoColorStyle);
        }
        return;
    }

    themeService._globalStyleElement = null;
    themeService.registerEditorContainer(monacoHostEl);
}

export async function ensurePublishMonacoStylesheet(
    targetDocument: Document = document,
): Promise<void> {
    const existingLink = getFallbackStylesheetLink(targetDocument);
    if (existingLink) {
        await waitForLinkLoad(existingLink);
        return;
    }

    if (documentHasMonacoStyles(targetDocument)) {
        return;
    }

    const head = targetDocument.head;
    if (!head) {
        throw new Error("[publish] document.head not found");
    }

    const link = targetDocument.createElement("link");
    link.rel = "stylesheet";
    link.href = monacoEditorStylesheetHref;
    link.setAttribute(FALLBACK_STYLESHEET_ATTR, "1");
    head.appendChild(link);
    await waitForLinkLoad(link);
}

export async function ensurePublishMonacoThemeServiceStyles(
    monacoHostEl: HTMLElement,
    targetDocument: Document = document,
): Promise<void> {
    const [{ StandaloneServices }, { IStandaloneThemeService }] =
        await Promise.all([
            import("monaco-editor/esm/vs/editor/standalone/browser/standaloneServices") as Promise<MonacoStandaloneServicesModule>,
            import("monaco-editor/esm/vs/editor/standalone/common/standaloneTheme") as Promise<MonacoStandaloneThemeModule>,
        ]);

    const themeService = StandaloneServices.get(IStandaloneThemeService);
    if (!isMonacoThemeServiceLike(themeService)) {
        return;
    }

    restoreDetachedMonacoThemeServiceStyles(
        themeService,
        monacoHostEl,
        targetDocument,
    );
}
