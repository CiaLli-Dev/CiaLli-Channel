import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    prepareEnterSkeletonForIncomingDocument,
    resolveEnterSkeletonModeFromPath,
    resolveTransitionProxyLayoutKeyFromPath,
    resolveTransitionProxyPayloadFromPath,
} from "../enter-skeleton";

const createClassList = () => {
    const values = new Set<string>();
    return {
        add: (...tokens: string[]) => {
            tokens.forEach((token) => values.add(token));
        },
        remove: (...tokens: string[]) => {
            tokens.forEach((token) => values.delete(token));
        },
        contains: (token: string) => values.has(token),
    };
};

describe("enter-skeleton", () => {
    beforeEach(() => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);
        vi.stubGlobal("window", {
            clearTimeout,
            setTimeout,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("prepareEnterSkeletonForIncomingDocument 会只给 incoming 文档打骨架状态", () => {
        const documentElement = Object.assign(new HTMLElement(), {
            classList: createClassList(),
            setAttribute: vi.fn(),
        });
        const targetDocument = {
            documentElement,
            querySelector: (selector: string) =>
                selector === '[data-enter-skeleton-target="post-detail"]'
                    ? {}
                    : null,
        } as unknown as Document;

        prepareEnterSkeletonForIncomingDocument(targetDocument);

        expect(
            documentElement.classList.contains("enter-skeleton-active"),
        ).toBe(true);
        expect(documentElement.setAttribute).toHaveBeenCalledWith(
            "data-enter-skeleton-mode",
            "post-detail",
        );
    });

    it("resolveEnterSkeletonModeFromPath 会把文章详情、归档与个人页路由映射到稳定 mode", () => {
        expect(resolveEnterSkeletonModeFromPath("/")).toBe("fallback");
        expect(resolveEnterSkeletonModeFromPath("/posts/demo")).toBe(
            "post-detail",
        );
        expect(resolveEnterSkeletonModeFromPath("/alice/diary/demo")).toBe(
            "diary-detail",
        );
        expect(resolveEnterSkeletonModeFromPath("/posts")).toBe("post-card");
        expect(resolveEnterSkeletonModeFromPath("/alice")).toBe("user-home");
        expect(resolveEnterSkeletonModeFromPath("/me/homepage")).toBe(
            "me-homepage",
        );
        expect(resolveEnterSkeletonModeFromPath("/admin/users")).toBe(
            "admin-users",
        );
        expect(resolveEnterSkeletonModeFromPath("/posts/new")).toBe(
            "publish-page",
        );
        expect(resolveEnterSkeletonModeFromPath("/unknown/path")).toBe(
            "fallback",
        );
    });

    it("resolveTransitionProxyLayoutKeyFromPath 会把右栏与全宽页面映射到正确代理壳", () => {
        expect(resolveTransitionProxyLayoutKeyFromPath("/posts")).toBe(
            "sidebar-main-right-archive",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/auth/login")).toBe(
            "sidebar-main",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/auth/register")).toBe(
            "sidebar-main",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/alice/bangumi")).toBe(
            "sidebar-main-right-bangumi",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/alice/albums")).toBe(
            "sidebar-main-right-albums",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/posts/demo")).toBe(
            "sidebar-main-right-default",
        );
        expect(resolveTransitionProxyLayoutKeyFromPath("/posts/new")).toBe(
            "full-width-post-editor",
        );
    });

    it("resolveTransitionProxyPayloadFromPath 会同时返回骨架 mode 与代理壳 key", () => {
        expect(resolveTransitionProxyPayloadFromPath("/")).toEqual({
            mode: "fallback",
            layoutKey: "sidebar-main",
        });
        expect(resolveTransitionProxyPayloadFromPath("/posts/new")).toEqual({
            mode: "publish-page",
            layoutKey: "full-width-post-editor",
        });
        expect(resolveTransitionProxyPayloadFromPath("/auth/login")).toEqual({
            mode: "auth-login",
            layoutKey: "sidebar-main",
        });
        expect(resolveTransitionProxyPayloadFromPath("/auth/register")).toEqual(
            {
                mode: "auth-register",
                layoutKey: "sidebar-main",
            },
        );
        expect(
            resolveTransitionProxyPayloadFromPath("/alice/diary/demo"),
        ).toEqual({
            mode: "diary-detail",
            layoutKey: "sidebar-main",
        });
    });
});
