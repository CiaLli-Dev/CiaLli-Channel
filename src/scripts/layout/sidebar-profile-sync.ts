/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
import { SOCIAL_PLATFORM_META } from "@constants/social-platforms";

type SidebarSocialMode = "single" | "multi";

type SidebarSocialLink = {
    platform: string;
    url: string;
    label: string;
    iconNodes: Node[];
};

export type SidebarProfilePatch = {
    uid: string;
    displayName: string;
    bio: string;
    profileLink: string;
    avatarUrl: string;
    socialMode: SidebarSocialMode;
    socialLinks: SidebarSocialLink[];
};

const PROFILE_UPDATE_TIMEOUT_MS = 420;
const SAFE_SOCIAL_URL_RE = /^(https?:\/\/|mailto:|tel:)/i;
const SOCIAL_LINK_FALLBACK_LABEL = "Link";
const SOCIAL_ICON_TAG_ALLOWLIST = new Set([
    "svg",
    "path",
    "g",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "ellipse",
    "defs",
    "clippath",
    "mask",
    "title",
    "desc",
    "symbol",
    "use",
    "span",
    "i",
]);

function clean(value: string | null | undefined): string {
    return String(value || "").trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value as Record<string, unknown>;
}

function isSafeSocialUrl(value: string): boolean {
    return SAFE_SOCIAL_URL_RE.test(value);
}

function resolveSocialLabel(platform: string, label?: string): string {
    const normalizedLabel = clean(label);
    if (normalizedLabel) {
        return normalizedLabel;
    }

    const meta = SOCIAL_PLATFORM_META[platform];
    if (meta?.label) {
        return meta.label;
    }

    return clean(platform) || SOCIAL_LINK_FALLBACK_LABEL;
}

function createSocialLink(
    platform: string,
    url: string,
    label?: string,
    iconNodes: Node[] = [],
): SidebarSocialLink | null {
    const normalizedUrl = clean(url);
    if (!normalizedUrl || !isSafeSocialUrl(normalizedUrl)) {
        return null;
    }

    const normalizedPlatform = clean(platform);
    return {
        platform: normalizedPlatform || "website",
        url: normalizedUrl,
        label: resolveSocialLabel(normalizedPlatform, label),
        iconNodes,
    };
}

function isHrefAttributeSafe(lower: string, value: string): boolean {
    if (lower !== "href" && lower !== "xlink:href") {
        return true;
    }
    const href = clean(value);
    return (
        href.startsWith("#") ||
        href.startsWith("data:image/") ||
        SAFE_SOCIAL_URL_RE.test(href)
    );
}

function cloneElementAttributes(source: Element, target: Element): void {
    for (const { name, value } of Array.from(source.attributes)) {
        const lower = name.toLowerCase();
        if (lower.startsWith("on") || lower === "style") {
            continue;
        }
        if (isHrefAttributeSafe(lower, value)) {
            target.setAttribute(name, value);
        }
    }
}

function cloneSafeSocialNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent ?? "");
    }
    if (!(node instanceof Element)) {
        return null;
    }
    const tagName = node.tagName.toLowerCase();
    if (!SOCIAL_ICON_TAG_ALLOWLIST.has(tagName)) {
        return null;
    }
    const namespace = node.namespaceURI ?? undefined;
    const cloned = namespace
        ? document.createElementNS(namespace, node.tagName)
        : document.createElement(node.tagName);
    cloneElementAttributes(node, cloned);
    for (const child of Array.from(node.childNodes)) {
        const safeChild = cloneSafeSocialNode(child);
        if (safeChild) {
            cloned.appendChild(safeChild);
        }
    }
    return cloned;
}

function extractSocialIconNodes(anchor: HTMLAnchorElement): Node[] {
    return Array.from(anchor.children)
        .map((child) => cloneSafeSocialNode(child))
        .filter((node): node is Node => node !== null);
}

function dedupeSocialLinks(links: SidebarSocialLink[]): SidebarSocialLink[] {
    const indexMap = new Map<string, number>();
    const deduped: SidebarSocialLink[] = [];

    for (const link of links) {
        const key = `${link.platform}::${link.url}`;
        const existingIndex = indexMap.get(key);
        if (typeof existingIndex === "number") {
            if (
                deduped[existingIndex] &&
                deduped[existingIndex].iconNodes.length === 0 &&
                link.iconNodes.length > 0
            ) {
                deduped[existingIndex] = {
                    ...deduped[existingIndex],
                    iconNodes: link.iconNodes,
                };
            }
            continue;
        }
        indexMap.set(key, deduped.length);
        deduped.push(link);
    }

    return deduped;
}

function parseSocialLinksFromDataset(
    raw: string | undefined,
): SidebarSocialLink[] {
    const text = clean(raw);
    if (!text) {
        return [];
    }

    try {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        const links = parsed
            .map((item) => {
                const record = toRecord(item);
                if (!record) {
                    return null;
                }
                const platform = clean(String(record.platform || ""));
                const url = clean(String(record.url || ""));
                const label = clean(String(record.label || ""));
                return createSocialLink(platform, url, label, []);
            })
            .filter((item): item is SidebarSocialLink => item !== null);

        return dedupeSocialLinks(links);
    } catch {
        return [];
    }
}

function parseSocialLinksFromAnchors(
    social: HTMLElement | null,
): SidebarSocialLink[] {
    if (!(social instanceof HTMLElement)) {
        return [];
    }

    const links = Array.from(social.querySelectorAll<HTMLAnchorElement>("a"))
        .map((anchor) => {
            const platform = clean(anchor.dataset.socialPlatform);
            const url = clean(anchor.getAttribute("href"));
            const label = clean(anchor.getAttribute("aria-label"));
            const iconNodes = extractSocialIconNodes(anchor);
            return createSocialLink(platform, url, label, iconNodes);
        })
        .filter((item): item is SidebarSocialLink => item !== null);

    return dedupeSocialLinks(links);
}

function resolveSocialMode(
    mode: string | undefined,
    links: SidebarSocialLink[],
): SidebarSocialMode {
    if (mode === "single" || mode === "multi") {
        return mode;
    }
    return links.length === 1 ? "single" : "multi";
}

function serializeSocialLinks(links: SidebarSocialLink[]): string {
    return JSON.stringify(
        links.map((link) => ({
            platform: link.platform,
            url: link.url,
            label: link.label,
        })),
    );
}

function createSocialAnchor(
    link: SidebarSocialLink,
    socialMode: SidebarSocialMode,
): HTMLAnchorElement {
    const anchor = document.createElement("a");
    const isSingle = socialMode === "single";

    anchor.setAttribute("rel", "me noopener noreferrer");
    anchor.setAttribute("aria-label", link.label);
    anchor.setAttribute("href", link.url);
    anchor.setAttribute("target", "_blank");
    anchor.dataset.socialPlatform = link.platform;
    const hasSafeIcon = link.iconNodes.length > 0;

    if (isSingle) {
        anchor.className =
            "btn-regular rounded-lg h-10 gap-2 px-3 font-bold active:scale-95 inline-flex items-center";
        if (hasSafeIcon) {
            for (const iconNode of link.iconNodes) {
                anchor.appendChild(iconNode.cloneNode(true));
            }
        } else {
            const icon = document.createElement("span");
            icon.className = "text-sm leading-none";
            icon.textContent = "↗";
            anchor.appendChild(icon);
        }
        const text = document.createElement("span");
        text.textContent = link.label;
        anchor.appendChild(text);
        return anchor;
    }

    anchor.className =
        "btn-regular rounded-lg h-10 w-10 active:scale-90 inline-flex items-center justify-center text-xs font-semibold uppercase";
    if (hasSafeIcon) {
        for (const iconNode of link.iconNodes) {
            anchor.appendChild(iconNode.cloneNode(true));
        }
        return anchor;
    }

    const compactLabel = clean(link.label)
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 2)
        .toUpperCase();
    anchor.textContent = compactLabel || "↗";
    return anchor;
}

/**
 * 社交链接使用结构化白名单重建，避免把旧 DOM 的 innerHTML 回放到新页面。
 */
function renderSocialLinks(
    social: HTMLElement,
    links: SidebarSocialLink[],
    mode: SidebarSocialMode,
): void {
    social.replaceChildren();
    if (links.length === 0) {
        return;
    }
    const socialMode: SidebarSocialMode =
        mode === "single" && links.length === 1 ? "single" : "multi";
    const renderLinks = socialMode === "single" ? links.slice(0, 1) : links;
    for (const link of renderLinks) {
        social.appendChild(createSocialAnchor(link, socialMode));
    }
}

function readProfileRoot(scope: ParentNode | null): HTMLElement | null {
    if (!scope) {
        return null;
    }
    const root = scope.querySelector<HTMLElement>(
        "[data-sidebar-profile-root]",
    );
    return root instanceof HTMLElement ? root : null;
}

function readAllProfileRoots(scope: ParentNode | null): HTMLElement[] {
    if (!scope) {
        return [];
    }
    return Array.from(
        scope.querySelectorAll<HTMLElement>("[data-sidebar-profile-root]"),
    );
}

function setAvatarShellLoading(shell: HTMLElement, isLoading: boolean): void {
    shell.dataset.avatarLoading = isLoading ? "true" : "false";
}

function isImageSettled(img: HTMLImageElement): boolean {
    return (
        img.complete &&
        Number.isFinite(img.naturalWidth) &&
        img.naturalWidth > 0
    );
}

function resolveAvatarImage(
    root: HTMLElement,
): { shell: HTMLElement; img: HTMLImageElement } | null {
    const shell = root.querySelector<HTMLElement>(
        "[data-sidebar-avatar-shell]",
    );
    if (!(shell instanceof HTMLElement)) {
        return null;
    }

    const img = shell.querySelector<HTMLImageElement>(
        "[data-sidebar-profile-avatar] img",
    );
    if (!(img instanceof HTMLImageElement)) {
        setAvatarShellLoading(shell, false);
        return null;
    }

    return { shell, img };
}

function observeAvatarImageLoad(
    shell: HTMLElement,
    img: HTMLImageElement,
): void {
    const observedSrc = clean(img.currentSrc || img.getAttribute("src"));
    const cachedObservedSrc = clean(shell.dataset.avatarObservedSrc);
    const listenerAttached = shell.dataset.avatarListenerAttached === "true";

    if (observedSrc && observedSrc === cachedObservedSrc && listenerAttached) {
        return;
    }

    shell.dataset.avatarObservedSrc = observedSrc;
    shell.dataset.avatarListenerAttached = "true";
    setAvatarShellLoading(shell, true);

    const settle = (): void => {
        setAvatarShellLoading(shell, false);
        delete shell.dataset.avatarListenerAttached;
    };

    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
}

export function syncSidebarAvatarLoadingState(scope: ParentNode | null): void {
    const roots = readAllProfileRoots(scope);
    if (roots.length === 0) {
        return;
    }

    roots.forEach((root) => {
        const avatar = resolveAvatarImage(root);
        if (!avatar) {
            return;
        }

        const { shell, img } = avatar;
        const avatarSrc = clean(img.currentSrc || img.getAttribute("src"));
        if (!avatarSrc) {
            setAvatarShellLoading(shell, false);
            return;
        }

        if (isImageSettled(img)) {
            setAvatarShellLoading(shell, false);
            return;
        }

        observeAvatarImageLoad(shell, img);
    });
}

export function extractSidebarProfilePatch(
    scope: ParentNode | null,
): SidebarProfilePatch | null {
    const root = readProfileRoot(scope);
    if (!root) {
        return null;
    }

    const link = root.querySelector<HTMLAnchorElement>(
        "[data-sidebar-profile-link]",
    );
    const name = root.querySelector<HTMLElement>("[data-sidebar-profile-name]");
    const bio = root.querySelector<HTMLElement>("[data-sidebar-profile-bio]");
    const avatar = root.querySelector<HTMLImageElement>(
        "[data-sidebar-profile-avatar] img",
    );
    const social = root.querySelector<HTMLElement>(
        "[data-sidebar-profile-social]",
    );

    const displayName =
        clean(root.dataset.sidebarProfileName) ||
        clean(name?.textContent) ||
        "user";
    const uid = clean(root.dataset.sidebarProfileUid) || "__official__";
    const profileLink =
        clean(root.dataset.sidebarProfileLink) ||
        clean(link?.getAttribute("href")) ||
        "/about";
    const avatarUrl =
        clean(root.dataset.sidebarProfileAvatar) ||
        clean(avatar?.getAttribute("src"));
    const bioText =
        clean(root.dataset.sidebarProfileBio) || clean(bio?.textContent);
    const socialLinksFromAnchors = parseSocialLinksFromAnchors(social);
    const socialLinksFromDataset = parseSocialLinksFromDataset(
        root.dataset.sidebarProfileSocialLinks,
    );
    const normalizedSocialLinks =
        socialLinksFromAnchors.length > 0
            ? socialLinksFromAnchors
            : socialLinksFromDataset;
    const socialMode = resolveSocialMode(
        root.dataset.sidebarProfileSocialMode,
        normalizedSocialLinks,
    );

    return {
        uid,
        displayName,
        bio: bioText,
        profileLink,
        avatarUrl,
        socialMode,
        socialLinks: normalizedSocialLinks,
    };
}

export function applySidebarProfilePatch(patch: SidebarProfilePatch): void {
    const sidebar = document.getElementById("sidebar");
    if (!(sidebar instanceof HTMLElement)) {
        return;
    }

    const roots = readAllProfileRoots(sidebar);
    if (roots.length === 0) {
        return;
    }

    const avatars: HTMLImageElement[] = [];

    roots.forEach((root) => {
        const link = root.querySelector<HTMLAnchorElement>(
            "[data-sidebar-profile-link]",
        );
        const name = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-name]",
        );
        const bio = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-bio]",
        );
        const avatar = root.querySelector<HTMLImageElement>(
            "[data-sidebar-profile-avatar] img",
        );
        const social = root.querySelector<HTMLElement>(
            "[data-sidebar-profile-social]",
        );

        if (link) {
            link.setAttribute("href", patch.profileLink || "/about");
        }
        if (name) {
            name.textContent = patch.displayName || "user";
        }
        if (bio) {
            bio.textContent = patch.bio;
        }
        if (social) {
            renderSocialLinks(social, patch.socialLinks, patch.socialMode);
        }
        if (avatar) {
            avatars.push(avatar);
        }

        root.dataset.sidebarProfileUid = patch.uid || "__official__";
        root.dataset.sidebarProfileName = patch.displayName || "user";
        root.dataset.sidebarProfileBio = patch.bio;
        root.dataset.sidebarProfileAvatar = patch.avatarUrl;
        root.dataset.sidebarProfileLink = patch.profileLink || "/about";
        root.dataset.sidebarProfileSocialMode = patch.socialMode;
        root.dataset.sidebarProfileSocialLinks = serializeSocialLinks(
            patch.socialLinks,
        );
    });

    sidebar.dataset.sidebarUid = patch.uid || "__official__";
    syncSidebarAvatarLoadingState(sidebar);

    const nextAvatarUrl = clean(patch.avatarUrl);
    const currentAvatarUrl = clean(avatars[0]?.getAttribute("src"));
    if (
        avatars.length === 0 ||
        !nextAvatarUrl ||
        nextAvatarUrl === currentAvatarUrl
    ) {
        syncSidebarAvatarLoadingState(sidebar);
        return;
    }

    let finished = false;
    const finish = (): void => {
        if (finished) {
            return;
        }
        finished = true;
        avatars.forEach((avatar) => {
            avatar.setAttribute("src", nextAvatarUrl);
            avatar.removeAttribute("srcset");
        });
        syncSidebarAvatarLoadingState(sidebar);
    };

    const preloader = new Image();
    preloader.addEventListener("load", finish, { once: true });
    preloader.addEventListener("error", finish, { once: true });
    preloader.src = nextAvatarUrl;
    window.setTimeout(finish, PROFILE_UPDATE_TIMEOUT_MS);
}
