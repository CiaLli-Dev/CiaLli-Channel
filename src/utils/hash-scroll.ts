import { getTocBaselineOffset } from "@/utils/toc-offset";

export type HashScrollBehavior = ScrollBehavior | "instant";

type HashScrollOptions = {
    behavior?: HashScrollBehavior;
    extraOffset?: number;
};

function normalizePathname(pathname: string): string {
    if (pathname === "/") {
        return pathname;
    }
    return pathname.replace(/\/+$/, "");
}

export function decodeHashId(hash: string): string {
    const normalizedHash = String(hash || "")
        .trim()
        .replace(/^#/, "");
    if (!normalizedHash) {
        return "";
    }

    try {
        return decodeURIComponent(normalizedHash);
    } catch {
        return normalizedHash;
    }
}

export function encodeHashId(id: string): string {
    return `#${encodeURIComponent(String(id || "").trim())}`;
}

export function getHashTarget(hash: string): HTMLElement | null {
    const id = decodeHashId(hash);
    if (!id) {
        return null;
    }
    return document.getElementById(id);
}

export function scrollElementBelowTocBaseline(
    target: HTMLElement,
    options: HashScrollOptions = {},
): number {
    const offset = getTocBaselineOffset(options.extraOffset ?? 0);
    const behavior = options.behavior ?? "smooth";
    const top = Math.max(
        0,
        target.getBoundingClientRect().top + window.scrollY - offset,
    );

    window.scrollTo({
        top,
        behavior: behavior as ScrollBehavior,
    });

    return top;
}

export function scrollToHashBelowTocBaseline(
    hash: string,
    options: HashScrollOptions = {},
): boolean {
    const target = getHashTarget(hash);
    if (!target) {
        return false;
    }

    scrollElementBelowTocBaseline(target, options);
    return true;
}

export function resolveSamePageHashLink(anchor: HTMLAnchorElement): {
    hash: string;
    id: string;
    target: HTMLElement;
} | null {
    const href = anchor.getAttribute("href");
    if (!href) {
        return null;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(href, window.location.href);
    } catch {
        return null;
    }

    const currentUrl = new URL(window.location.href);
    if (
        parsedUrl.origin !== currentUrl.origin ||
        normalizePathname(parsedUrl.pathname) !==
            normalizePathname(currentUrl.pathname) ||
        parsedUrl.search !== currentUrl.search
    ) {
        return null;
    }

    const id = decodeHashId(parsedUrl.hash);
    if (!id) {
        return null;
    }

    const target = document.getElementById(id);
    if (!target) {
        return null;
    }

    return {
        hash: parsedUrl.hash,
        id,
        target,
    };
}
