import type { AuthState } from "@/scripts/auth/state";

export const AUTH_PROTECTED_TARGET_ATTR = "data-auth-target-href";

export type InternalTarget = {
    pathname: string;
    search: string;
    hash: string;
};

type AuthRoutingState = Pick<AuthState, "username" | "isLoggedIn">;

type UpdateUserRouteLinksOptions = AuthRoutingState & {
    root?: ParentNode;
    baseOrigin?: string;
};

export function normalizePathname(pathname: string): string {
    const normalized = pathname.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

export function isPublishPathname(pathname: string): boolean {
    const normalizedPath = normalizePathname(pathname);
    return (
        normalizedPath === "/posts/new" ||
        /^\/posts\/[^/]+\/edit$/.test(normalizedPath)
    );
}

export function parseInternalTarget(
    href: string,
    baseOrigin = window.location.origin,
): InternalTarget | null {
    if (!href.startsWith("/")) {
        return null;
    }

    try {
        const parsed = new URL(href, baseOrigin);
        return {
            pathname: normalizePathname(parsed.pathname),
            search: parsed.search,
            hash: parsed.hash,
        };
    } catch {
        const [pathAndSearch, hashPart = ""] = href.split("#", 2);
        const [pathPart, searchPart = ""] = pathAndSearch.split("?", 2);
        return {
            pathname: normalizePathname(pathPart || "/"),
            search: searchPart ? `?${searchPart}` : "",
            hash: hashPart ? `#${hashPart}` : "",
        };
    }
}

export function setAuthProtectedLink(
    anchor: HTMLAnchorElement,
    targetHref: string,
): void {
    anchor.setAttribute(AUTH_PROTECTED_TARGET_ATTR, targetHref);
    anchor.setAttribute("href", "#");
    anchor.setAttribute("data-needs-login", "");
}

export function clearAuthProtectedLink(
    anchor: HTMLAnchorElement,
    href: string,
): void {
    anchor.setAttribute("href", href);
    anchor.removeAttribute("data-needs-login");
    anchor.removeAttribute(AUTH_PROTECTED_TARGET_ATTR);
}

function resolveUserSegmentPath(
    pathname: string,
    cleanUsername: string,
): string {
    const segments = pathname.split("/").filter(Boolean);
    const resolved = segments
        .map((segment) => (segment === "__user__" ? cleanUsername : segment))
        .join("/");
    return `/${resolved}`;
}

function updatePublishLink(
    anchor: HTMLAnchorElement,
    target: InternalTarget,
    isLoggedIn: boolean,
): void {
    const publishHref = `${target.pathname}${target.search}${target.hash}`;
    if (isLoggedIn) {
        clearAuthProtectedLink(anchor, publishHref);
        return;
    }
    setAuthProtectedLink(anchor, publishHref);
}

function updateUserPlaceholderLink(
    anchor: HTMLAnchorElement,
    target: InternalTarget,
    cleanUsername: string,
    isLoggedIn: boolean,
): void {
    if (cleanUsername) {
        const resolvedPath = resolveUserSegmentPath(
            target.pathname,
            cleanUsername,
        );
        clearAuthProtectedLink(
            anchor,
            `${resolvedPath}${target.search}${target.hash}`,
        );
        return;
    }
    if (!isLoggedIn) {
        setAuthProtectedLink(
            anchor,
            `${target.pathname}${target.search}${target.hash}`,
        );
        return;
    }
    clearAuthProtectedLink(anchor, "/me");
}

function updateMeHashLink(
    anchor: HTMLAnchorElement,
    target: InternalTarget,
    hashLower: string,
    cleanUsername: string,
    isLoggedIn: boolean,
): boolean {
    const meHashTargets = ["bangumi", "diary", "albums"];
    if (!meHashTargets.includes(hashLower)) {
        return false;
    }
    if (cleanUsername) {
        clearAuthProtectedLink(anchor, `/${cleanUsername}/${hashLower}`);
        return true;
    }
    if (!isLoggedIn) {
        setAuthProtectedLink(
            anchor,
            `${target.pathname}${target.search}${target.hash}`,
        );
        return true;
    }
    clearAuthProtectedLink(anchor, "/me");
    return true;
}

function updateProtectedMeRouteLink(
    anchor: HTMLAnchorElement,
    target: InternalTarget,
    isLoggedIn: boolean,
): void {
    const targetHref = `${target.pathname}${target.search}${target.hash}`;
    if (isLoggedIn) {
        clearAuthProtectedLink(anchor, targetHref);
        return;
    }
    setAuthProtectedLink(anchor, targetHref);
}

function updateLegacyLink(
    anchor: HTMLAnchorElement,
    pathname: string,
    cleanUsername: string,
    isLoggedIn: boolean,
): void {
    const target = pathname.replace(/^\//, "");
    if (cleanUsername) {
        clearAuthProtectedLink(anchor, `/${cleanUsername}/${target}`);
        return;
    }
    if (!isLoggedIn) {
        setAuthProtectedLink(anchor, `/${target}`);
        return;
    }
    clearAuthProtectedLink(anchor, "/me");
}

export function updateAnchorForAuth(
    anchor: HTMLAnchorElement,
    state: AuthRoutingState,
    baseOrigin?: string,
): void {
    const rawHref = anchor.getAttribute("href") || "";
    const targetHref =
        anchor.getAttribute(AUTH_PROTECTED_TARGET_ATTR) || rawHref;
    const parsedTarget = parseInternalTarget(targetHref, baseOrigin);
    if (!parsedTarget) {
        return;
    }

    if (isPublishPathname(parsedTarget.pathname)) {
        updatePublishLink(anchor, parsedTarget, state.isLoggedIn);
        return;
    }

    const cleanUsername = String(state.username || "").trim();
    const hasUserPlaceholder = parsedTarget.pathname
        .split("/")
        .filter(Boolean)
        .includes("__user__");

    if (hasUserPlaceholder) {
        updateUserPlaceholderLink(
            anchor,
            parsedTarget,
            cleanUsername,
            state.isLoggedIn,
        );
        return;
    }

    const hashLower = parsedTarget.hash.replace(/^#/, "").trim().toLowerCase();
    if (parsedTarget.pathname === "/me") {
        if (
            hashLower &&
            updateMeHashLink(
                anchor,
                parsedTarget,
                hashLower,
                cleanUsername,
                state.isLoggedIn,
            )
        ) {
            return;
        }
        updateProtectedMeRouteLink(anchor, parsedTarget, state.isLoggedIn);
        return;
    }

    if (parsedTarget.pathname === "/me/homepage") {
        updateProtectedMeRouteLink(anchor, parsedTarget, state.isLoggedIn);
        return;
    }

    const legacyTarget = ["/bangumi", "/diary", "/albums"];
    if (!legacyTarget.includes(parsedTarget.pathname)) {
        return;
    }
    updateLegacyLink(
        anchor,
        parsedTarget.pathname,
        cleanUsername,
        state.isLoggedIn,
    );
}

export function updateUserRouteLinks({
    root = document,
    username,
    isLoggedIn,
    baseOrigin,
}: UpdateUserRouteLinksOptions): void {
    const anchors = Array.from(
        root.querySelectorAll<HTMLAnchorElement>("a[href]"),
    );
    anchors.forEach((anchor) => {
        updateAnchorForAuth(anchor, { username, isLoggedIn }, baseOrigin);
    });
}
