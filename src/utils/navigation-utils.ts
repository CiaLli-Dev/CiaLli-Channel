import { navigate } from "astro:transitions/client";
import { scrollToHashBelowTocBaseline } from "@/utils/hash-scroll";

/**
 * 导航工具函数
 * 提供统一的页面导航功能，使用 Astro View Transitions navigate() API
 */

/**
 * 导航到指定页面
 * @param url 目标页面URL
 * @param options 导航选项
 */
export function navigateToPage(
    url: unknown,
    options?: {
        replace?: boolean;
        force?: boolean;
    },
): void {
    // 检查 URL 是否有效
    if (typeof url !== "string" || !url) {
        console.warn("navigateToPage: Invalid URL provided");
        return;
    }

    // 如果是外部链接，直接跳转
    if (
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("//")
    ) {
        window.open(url, "_blank");
        return;
    }

    // 如果是锚点链接，滚动到对应位置
    if (url.startsWith("#")) {
        scrollToHashBelowTocBaseline(url, { behavior: "smooth" });
        return;
    }

    // 站内同 URL 导航直接忽略，避免重复触发过渡与组件重挂载。
    try {
        const target = new URL(url, window.location.origin);
        const current = new URL(window.location.href);
        const isSameOrigin = target.origin === current.origin;
        const isSamePathAndSearch =
            target.pathname === current.pathname &&
            target.search === current.search;

        if (
            isSameOrigin &&
            isSamePathAndSearch &&
            target.hash &&
            target.hash !== current.hash
        ) {
            history.pushState(null, "", target.hash);
            scrollToHashBelowTocBaseline(target.hash, { behavior: "smooth" });
            return;
        }

        if (
            isSameOrigin &&
            isSamePathAndSearch &&
            target.hash === current.hash
        ) {
            return;
        }
    } catch {
        // ignore invalid relative URL parsing and continue navigation fallback
    }

    // 强制整页跳转
    if (options?.force) {
        fallbackNavigation(url, options);
        return;
    }

    // 使用 Astro View Transitions navigate() API
    try {
        navigate(url, {
            history: options?.replace ? "replace" : "push",
        });
    } catch (error) {
        console.error("Astro navigation failed:", error);
        fallbackNavigation(url, options);
    }
}

/**
 * 降级导航函数
 */
function fallbackNavigation(
    url: string,
    options?: {
        replace?: boolean;
        force?: boolean;
    },
): void {
    if (options?.replace) {
        window.location.replace(url);
    } else {
        window.location.href = url;
    }
}

/**
 * ClientRouter 始终可用，返回 true
 */
export function isNavigationReady(): boolean {
    return true;
}

/**
 * ClientRouter 始终可用，立即 resolve
 */
export function waitForNavigation(_timeout = 5000): Promise<boolean> {
    return Promise.resolve(true);
}

/**
 * 预加载页面（Astro 自动处理 prefetch）
 */
export function preloadPage(_url: string): void {
    // Astro prefetch 自动处理，无需手动预加载
}

/**
 * 获取当前页面路径
 */
export function getCurrentPath(): string {
    return typeof window !== "undefined" ? window.location.pathname : "";
}

/**
 * 检查是否为首页
 */
export function isHomePage(): boolean {
    const path = getCurrentPath();
    return path === "/" || path === "";
}

/**
 * 检查是否为文章页面
 */
export function isPostPage(): boolean {
    const path = getCurrentPath();
    return path.startsWith("/posts/");
}

/**
 * 检查两个路径是否相等
 */
export function pathsEqual(path1: string, path2: string): boolean {
    // 标准化路径（移除末尾斜杠）
    const normalize = (path: string) => {
        return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
    };

    return normalize(path1) === normalize(path2);
}
