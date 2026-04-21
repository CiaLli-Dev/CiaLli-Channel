import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    applySidebarAvatarStateAttributes,
    applySidebarProfilePatch,
    extractSidebarProfilePatch,
    resolveSidebarAvatarState,
    type SidebarAvatarState,
    type SidebarProfilePatch,
} from "../sidebar-profile-sync";

class MockElement {
    dataset: Record<string, string> = {};
    textContent = "";
    private readonly attributes = new Map<string, string>();
    private readonly singleQueryMap = new Map<string, unknown>();
    private readonly multiQueryMap = new Map<string, unknown[]>();

    setQuery(selector: string, value: unknown): void {
        this.singleQueryMap.set(selector, value);
    }

    setQueryAll(selector: string, value: unknown[]): void {
        this.multiQueryMap.set(selector, value);
    }

    querySelector<T>(selector: string): T | null {
        return (this.singleQueryMap.get(selector) as T | undefined) ?? null;
    }

    querySelectorAll<T>(selector: string): T[] {
        return (this.multiQueryMap.get(selector) as T[] | undefined) ?? [];
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    replaceChildren(): void {
        // 当前测试只关心清空行为，不需要真正持有子节点。
    }
}

class MockImageElement extends MockElement {
    currentSrc = "";
    complete = true;
    naturalWidth = 96;
}

class MockImagePreloader {
    private readonly listeners = new Map<string, () => void>();
    private value = "";

    addEventListener(event: string, listener: () => void): void {
        this.listeners.set(event, listener);
    }

    set src(value: string) {
        this.value = value;
        const loadListener = this.listeners.get("load");
        if (loadListener) {
            loadListener();
        }
    }

    get src(): string {
        return this.value;
    }
}

type SidebarFixture = {
    sidebar: MockElement;
    root: MockElement;
    avatarShell: MockElement;
    avatar: MockImageElement;
};

function createAvatarState(
    overrides: Partial<SidebarAvatarState> = {},
): SidebarAvatarState {
    return {
        src: "https://cdn.example/avatar.png",
        srcset: "",
        sizes: "",
        ...overrides,
    };
}

function createSidebarFixture(input?: {
    datasetAvatar?: string;
    initialAvatar?: SidebarAvatarState;
}): SidebarFixture {
    const avatarState = input?.initialAvatar ?? createAvatarState();
    const datasetAvatar = input?.datasetAvatar ?? avatarState.src;

    const sidebar = new MockElement();
    const root = new MockElement();
    const link = new MockElement();
    const name = new MockElement();
    const bio = new MockElement();
    const social = new MockElement();
    const avatarShell = new MockElement();
    const avatar = new MockImageElement();

    root.dataset.sidebarProfileUid = "alice";
    root.dataset.sidebarProfileName = "Alice";
    root.dataset.sidebarProfileBio = "Hello";
    root.dataset.sidebarProfileAvatar = datasetAvatar;
    root.dataset.sidebarProfileLink = "/alice";
    root.dataset.sidebarProfileSocialMode = "multi";
    root.dataset.sidebarProfileSocialLinks = "[]";

    link.setAttribute("href", "/alice");
    name.textContent = "Alice";
    bio.textContent = "Hello";
    social.setQueryAll("a", []);

    avatar.setAttribute("src", avatarState.src);
    avatar.currentSrc = avatarState.src;
    if (avatarState.srcset) {
        avatar.setAttribute("srcset", avatarState.srcset);
    }
    if (avatarState.sizes) {
        avatar.setAttribute("sizes", avatarState.sizes);
    }

    avatarShell.dataset.avatarLoading = "true";
    avatarShell.setQuery("[data-sidebar-profile-avatar] img", avatar);

    root.setQuery("[data-sidebar-profile-link]", link);
    root.setQuery("[data-sidebar-profile-name]", name);
    root.setQuery("[data-sidebar-profile-bio]", bio);
    root.setQuery("[data-sidebar-profile-social]", social);
    root.setQuery("[data-sidebar-avatar-shell]", avatarShell);
    root.setQuery("[data-sidebar-profile-avatar] img", avatar);

    sidebar.setQueryAll("[data-sidebar-profile-root]", [root]);

    return {
        sidebar,
        root,
        avatarShell,
        avatar,
    };
}

describe("sidebar-profile-sync", () => {
    beforeEach(() => {
        vi.stubGlobal("HTMLElement", MockElement);
        vi.stubGlobal("HTMLImageElement", MockImageElement);
        vi.stubGlobal("Image", MockImagePreloader);
        vi.stubGlobal("window", {
            setTimeout: (callback: () => void) => {
                callback();
                return 1;
            },
            clearTimeout,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("resolveSidebarAvatarState 会优先使用已解析的 currentSrc，而不是相对 fallback", () => {
        const avatarState = resolveSidebarAvatarState({
            currentSrc:
                "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=1536&f=webp",
            src: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=96&f=webp",
            srcset: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=96&f=webp 96w",
            sizes: "96px",
            fallbackSrc: "assets/images/avatar.webp",
        });

        expect(avatarState).toEqual({
            src: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=1536&f=webp",
            srcset: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=96&f=webp 96w",
            sizes: "96px",
        });
    });

    it("extractSidebarProfilePatch 会从 img 提取已渲染头像属性，而不是 data 中的相对路径", () => {
        const defaultAvatarState = createAvatarState({
            src: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=1536&f=webp",
            srcset: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=96&f=webp 96w, /_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=192&f=webp 192w",
            sizes: "96px",
        });
        const fixture = createSidebarFixture({
            datasetAvatar: "assets/images/avatar.webp",
            initialAvatar: defaultAvatarState,
        });
        const scope = new MockElement();
        scope.setQuery("[data-sidebar-profile-root]", fixture.root);

        const patch = extractSidebarProfilePatch(
            scope as unknown as ParentNode,
        );

        expect(patch).not.toBeNull();
        expect(patch?.avatar).toEqual(defaultAvatarState);
    });

    it("applySidebarProfilePatch 会把默认头像的完整属性回放到保活侧栏", () => {
        const currentFixture = createSidebarFixture({
            initialAvatar: createAvatarState({
                src: "https://cdn.example/external-avatar.png",
            }),
        });

        vi.stubGlobal("document", {
            getElementById: (id: string) =>
                id === "sidebar" ? currentFixture.sidebar : null,
        });

        const nextPatch: SidebarProfilePatch = {
            uid: "bob",
            displayName: "Bob",
            bio: "Default avatar",
            profileLink: "/bob",
            avatar: {
                src: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=1536&f=webp",
                srcset: "/_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=96&f=webp 96w, /_image?href=%2F_astro%2Favatar.BDCKBkzJ.webp&w=192&f=webp 192w",
                sizes: "96px",
            },
            socialMode: "multi",
            socialLinks: [],
        };

        applySidebarProfilePatch(nextPatch);

        expect(currentFixture.avatar.getAttribute("src")).toBe(
            nextPatch.avatar.src,
        );
        expect(currentFixture.avatar.getAttribute("srcset")).toBe(
            nextPatch.avatar.srcset,
        );
        expect(currentFixture.avatar.getAttribute("sizes")).toBe(
            nextPatch.avatar.sizes,
        );
        expect(currentFixture.root.dataset.sidebarProfileAvatar).toBe(
            nextPatch.avatar.src,
        );
        expect(currentFixture.avatarShell.dataset.avatarLoading).toBe("false");
    });

    it("applySidebarAvatarStateAttributes 会在切到外部头像时清理旧的 srcset 与 sizes", () => {
        const target = new MockImageElement();
        target.setAttribute("src", "/_image?href=%2F_astro%2Favatar.webp");
        target.setAttribute("srcset", "/_image?href=%2F_astro%2Favatar.webp");
        target.setAttribute("sizes", "96px");

        applySidebarAvatarStateAttributes(target, {
            src: "https://cdn.example/avatar.png",
            srcset: "",
            sizes: "",
        });

        expect(target.getAttribute("src")).toBe(
            "https://cdn.example/avatar.png",
        );
        expect(target.getAttribute("srcset")).toBeNull();
        expect(target.getAttribute("sizes")).toBeNull();
    });
});
