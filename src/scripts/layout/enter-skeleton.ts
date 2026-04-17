export type EnterSkeletonMode =
    | "post-card"
    | "post-detail"
    | "diary-detail"
    | "publish-page"
    | "user-home"
    | "user-bangumi"
    | "user-albums"
    | "user-diary"
    | "me-homepage"
    | "admin-dashboard"
    | "admin-users"
    | "admin-site-settings"
    | "admin-bulletin-settings"
    | "admin-about-settings"
    | "me-settings"
    | "about-page"
    | "friends-page"
    | "stats-page"
    | "bulletin-page"
    | "auth-login"
    | "auth-register"
    | "rss-page"
    | "atom-page"
    | "fallback";

export type TransitionProxyLayoutKey =
    | "sidebar-main"
    | "sidebar-main-right-default"
    | "sidebar-main-right-article-list"
    | "sidebar-main-right-bangumi"
    | "sidebar-main-right-albums"
    | "full-width-post-editor";

export type TransitionProxyPayload = {
    mode: EnterSkeletonMode;
    layoutKey: TransitionProxyLayoutKey;
};

type SkeletonPathRule = {
    test: RegExp;
    mode: EnterSkeletonMode;
};

const ACTIVE_CLASS = "enter-skeleton-active";
const MODE_ATTR = "data-enter-skeleton-mode";
const MIN_VISIBLE_MS = 120;
const RUNTIME_MIN_HEIGHT_ATTR = "data-enter-skeleton-runtime-min-height";
const RUNTIME_MIN_HEIGHT_PREV_ATTR =
    "data-enter-skeleton-runtime-min-height-prev";

let activatedAt = 0;
let deactivationTimer: number | null = null;
let activationToken = 0;

function getRoot(): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }
    return document.documentElement;
}

function clearDeactivationTimer(): void {
    if (deactivationTimer !== null) {
        window.clearTimeout(deactivationTimer);
        deactivationTimer = null;
    }
}

function resolveRuntimeSkeletonMinHeightPx(): number {
    if (typeof window === "undefined") {
        return 0;
    }
    return Math.max(0, Math.ceil(window.scrollY + window.innerHeight));
}

function markRuntimeMinHeight(
    element: HTMLElement,
    runtimeMinHeightPx: number,
): void {
    if (runtimeMinHeightPx <= 0) {
        return;
    }
    if (!element.hasAttribute(RUNTIME_MIN_HEIGHT_ATTR)) {
        const previousMinHeight = element.style.minHeight;
        if (previousMinHeight.length > 0) {
            element.setAttribute(
                RUNTIME_MIN_HEIGHT_PREV_ATTR,
                previousMinHeight,
            );
        }
    }
    element.style.minHeight = `${runtimeMinHeightPx}px`;
    element.setAttribute(RUNTIME_MIN_HEIGHT_ATTR, "true");
}

function applyRuntimeSkeletonMinHeight(
    targetDocument: Document = document,
): void {
    const runtimeMinHeightPx = resolveRuntimeSkeletonMinHeightPx();
    if (runtimeMinHeightPx <= 0) {
        return;
    }

    const targets = new Set<HTMLElement>();
    const pageTarget = targetDocument.querySelector<HTMLElement>(
        "[data-enter-skeleton-page][data-enter-skeleton-target]",
    );
    if (pageTarget instanceof HTMLElement) {
        targets.add(pageTarget);
    }

    const mainContainer = targetDocument.getElementById("main-container");
    if (mainContainer instanceof HTMLElement) {
        targets.add(mainContainer);
    }

    targets.forEach((target) => {
        // 进入骨架阶段要覆盖“当前滚动位 + 当前视口”，否则高滚动位会直接落到骨架底部之外。
        markRuntimeMinHeight(target, runtimeMinHeightPx);
    });
}

function clearRuntimeSkeletonMinHeight(
    targetDocument: Document = document,
): void {
    const targets = targetDocument.querySelectorAll<HTMLElement>(
        `[${RUNTIME_MIN_HEIGHT_ATTR}]`,
    );
    targets.forEach((target) => {
        const previousMinHeight =
            target.getAttribute(RUNTIME_MIN_HEIGHT_PREV_ATTR) ?? "";
        if (previousMinHeight.length > 0) {
            target.style.minHeight = previousMinHeight;
        } else {
            target.style.removeProperty("min-height");
        }
        target.removeAttribute(RUNTIME_MIN_HEIGHT_ATTR);
        target.removeAttribute(RUNTIME_MIN_HEIGHT_PREV_ATTR);
    });
}

type SkeletonDetectRule = {
    selector: string;
    mode: EnterSkeletonMode;
};

const SKELETON_TARGET_RULES: SkeletonDetectRule[] = [
    {
        selector: '[data-enter-skeleton-page="publish-page"]',
        mode: "publish-page",
    },
    {
        selector: '[data-enter-skeleton-target="post-detail"]',
        mode: "post-detail",
    },
    {
        selector: '[data-enter-skeleton-target="post-card"]',
        mode: "post-card",
    },
];

const SKELETON_PAGE_RULES: SkeletonDetectRule[] = [
    { selector: '[data-enter-skeleton-page="user-home"]', mode: "user-home" },
    {
        selector: '[data-enter-skeleton-page="user-bangumi"]',
        mode: "user-bangumi",
    },
    {
        selector: '[data-enter-skeleton-page="user-albums"]',
        mode: "user-albums",
    },
    {
        selector: '[data-enter-skeleton-page="user-diary"]',
        mode: "user-diary",
    },
    {
        selector: '[data-enter-skeleton-page="me-homepage"]',
        mode: "me-homepage",
    },
    {
        selector: '[data-enter-skeleton-page="admin-dashboard"]',
        mode: "admin-dashboard",
    },
    {
        selector: '[data-enter-skeleton-page="admin-users"]',
        mode: "admin-users",
    },
    {
        selector: '[data-enter-skeleton-page="admin-site-settings"]',
        mode: "admin-site-settings",
    },
    {
        selector: '[data-enter-skeleton-page="admin-bulletin-settings"]',
        mode: "admin-bulletin-settings",
    },
    {
        selector: '[data-enter-skeleton-page="admin-about-settings"]',
        mode: "admin-about-settings",
    },
    {
        selector: '[data-enter-skeleton-page="me-settings"]',
        mode: "me-settings",
    },
    {
        selector: '[data-enter-skeleton-page="about-page"]',
        mode: "about-page",
    },
    {
        selector: '[data-enter-skeleton-page="friends-page"]',
        mode: "friends-page",
    },
    {
        selector: '[data-enter-skeleton-page="stats-page"]',
        mode: "stats-page",
    },
    {
        selector: '[data-enter-skeleton-page="bulletin-page"]',
        mode: "bulletin-page",
    },
    {
        selector: '[data-enter-skeleton-page="auth-login"]',
        mode: "auth-login",
    },
    {
        selector: '[data-enter-skeleton-page="auth-register"]',
        mode: "auth-register",
    },
    { selector: '[data-enter-skeleton-page="rss-page"]', mode: "rss-page" },
    { selector: '[data-enter-skeleton-page="atom-page"]', mode: "atom-page" },
];

const SKELETON_PATH_RULES: readonly SkeletonPathRule[] = [
    { test: /^\/$/, mode: "fallback" },
    { test: /^\/posts\/new$/, mode: "publish-page" },
    { test: /^\/posts\/[^/]+\/edit$/, mode: "publish-page" },
    { test: /^\/posts$/, mode: "post-card" },
    { test: /^\/posts\/[^/]+$/, mode: "post-detail" },
    { test: /^\/[^/]+\/diary\/[^/]+$/, mode: "diary-detail" },
    { test: /^\/[^/]+\/bangumi$/, mode: "user-bangumi" },
    { test: /^\/[^/]+\/albums$/, mode: "user-albums" },
    { test: /^\/[^/]+\/diary$/, mode: "user-diary" },
    { test: /^\/admin\/settings\/site$/, mode: "admin-site-settings" },
    {
        test: /^\/admin\/settings\/bulletin$/,
        mode: "admin-bulletin-settings",
    },
    { test: /^\/admin\/settings\/about$/, mode: "admin-about-settings" },
    { test: /^\/admin\/users$/, mode: "admin-users" },
    { test: /^\/admin$/, mode: "admin-dashboard" },
    { test: /^\/me\/homepage$/, mode: "me-homepage" },
    { test: /^\/me$/, mode: "me-settings" },
    { test: /^\/about$/, mode: "about-page" },
    { test: /^\/friends$/, mode: "friends-page" },
    { test: /^\/stats$/, mode: "stats-page" },
    { test: /^\/bulletin$/, mode: "bulletin-page" },
    { test: /^\/auth\/login$/, mode: "auth-login" },
    { test: /^\/auth\/register$/, mode: "auth-register" },
    { test: /^\/rss$/, mode: "rss-page" },
    { test: /^\/atom$/, mode: "atom-page" },
    { test: /^\/[^/]+$/, mode: "user-home" },
] as const;

function normalizeSkeletonPath(pathname: string): string {
    const normalized = String(pathname || "").replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

function matchSkeletonRule(
    rules: SkeletonDetectRule[],
    targetDocument: Document,
): EnterSkeletonMode | null {
    for (const rule of rules) {
        if (targetDocument.querySelector(rule.selector)) {
            return rule.mode;
        }
    }
    return null;
}

function detectEnterSkeletonMode(
    targetDocument: Document = document,
): EnterSkeletonMode {
    return (
        matchSkeletonRule(SKELETON_TARGET_RULES, targetDocument) ??
        matchSkeletonRule(SKELETON_PAGE_RULES, targetDocument) ??
        "fallback"
    );
}

function applyMode(mode: EnterSkeletonMode, root: HTMLElement | null): void {
    if (!root) {
        return;
    }

    root.classList.add(ACTIVE_CLASS);
    root.setAttribute(MODE_ATTR, mode);
}

function clearMode(): void {
    const root = getRoot();
    if (!root) {
        return;
    }

    clearRuntimeSkeletonMinHeight();
    root.classList.remove(ACTIVE_CLASS);
    root.removeAttribute(MODE_ATTR);
}

export function prepareEnterSkeletonForIncomingDocument(
    targetDocument: Document,
): void {
    if (typeof window === "undefined") {
        return;
    }

    activationToken += 1;
    clearDeactivationTimer();
    activatedAt = performance.now();
    applyRuntimeSkeletonMinHeight(targetDocument);
    applyMode(
        detectEnterSkeletonMode(targetDocument),
        targetDocument.documentElement,
    );
}

export function deactivateEnterSkeleton(): void {
    const root = getRoot();
    if (!root || typeof window === "undefined") {
        return;
    }
    if (!root.classList.contains(ACTIVE_CLASS)) {
        return;
    }

    const elapsed = performance.now() - activatedAt;
    const remainingMs = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const currentToken = activationToken;
    const finish = (): void => {
        if (currentToken !== activationToken) {
            return;
        }
        clearDeactivationTimer();
        clearMode();
        activatedAt = 0;
    };

    if (remainingMs <= 0) {
        finish();
        return;
    }

    clearDeactivationTimer();
    deactivationTimer = window.setTimeout(finish, Math.ceil(remainingMs));
}

export function forceResetEnterSkeleton(): void {
    activationToken += 1;
    clearDeactivationTimer();
    activatedAt = 0;
    clearMode();
}

export function syncEnterSkeletonStateToIncomingDocument(
    newDocument: Document,
): void {
    const incomingRoot = newDocument.documentElement;
    if (!(incomingRoot instanceof HTMLElement)) {
        return;
    }
    prepareEnterSkeletonForIncomingDocument(newDocument);
}

export function resolveEnterSkeletonModeFromPath(
    pathname: string,
): EnterSkeletonMode {
    const normalizedPath = normalizeSkeletonPath(pathname);
    for (const rule of SKELETON_PATH_RULES) {
        if (rule.test.test(normalizedPath)) {
            return rule.mode;
        }
    }
    return "fallback";
}

export function resolveTransitionProxyLayoutKeyFromPath(
    pathname: string,
    mode: EnterSkeletonMode = resolveEnterSkeletonModeFromPath(pathname),
): TransitionProxyLayoutKey {
    const normalizedPath = normalizeSkeletonPath(pathname);
    if (
        normalizedPath === "/posts/new" ||
        /^\/posts\/[^/]+\/edit$/.test(normalizedPath)
    ) {
        return "full-width-post-editor";
    }
    if (normalizedPath === "/posts") {
        return "sidebar-main-right-article-list";
    }
    if (/^\/[^/]+\/bangumi$/.test(normalizedPath)) {
        return "sidebar-main-right-bangumi";
    }
    if (/^\/[^/]+\/albums$/.test(normalizedPath)) {
        return "sidebar-main-right-albums";
    }
    if (mode === "post-detail") {
        return "sidebar-main-right-default";
    }
    return "sidebar-main";
}

export function resolveTransitionProxyPayloadFromPath(
    pathname: string,
): TransitionProxyPayload {
    const mode = resolveEnterSkeletonModeFromPath(pathname);
    return {
        mode,
        layoutKey: resolveTransitionProxyLayoutKeyFromPath(pathname, mode),
    };
}
