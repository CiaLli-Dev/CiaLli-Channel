import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage: vi.fn(),
}));

vi.mock("@/scripts/shared/dialogs", () => ({
    showConfirmDialog: vi.fn(),
    showNoticeDialog: vi.fn(),
}));

vi.mock("@/utils/csrf", () => ({
    getCsrfToken: vi.fn().mockReturnValue("csrf-token"),
}));

import {
    loadArticleViewerLikeState,
    resetArticleViewerLikeStateRequestsForTest,
} from "@/scripts/interactions/detail-action-float-helpers";
import type { AuthState } from "@/scripts/auth/state";

function createLoggedInState(userId = "user-1"): AuthState {
    return {
        userId,
        username: "alice",
        isAdmin: false,
        isLoggedIn: true,
    };
}

describe("detail-action-float viewer like sync", () => {
    afterEach(() => {
        resetArticleViewerLikeStateRequestsForTest();
    });

    it("登录后会拉取当前文章 viewer like 状态", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ok: true,
                    article_id: "article-1",
                    liked: true,
                }),
            ),
        );

        const result = await loadArticleViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: createLoggedInState(),
            fetchImpl,
        });

        expect(result).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("同一用户同一文章的双浮条同步会复用同一请求", async () => {
        let resolveResponse!: (value: Response) => void;
        const fetchImpl = vi.fn().mockImplementation(
            async () =>
                await new Promise<Response>((resolve) => {
                    resolveResponse = resolve;
                }),
        );

        const state = createLoggedInState();
        const firstRequest = loadArticleViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: state,
            fetchImpl,
        });
        const secondRequest = loadArticleViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: state,
            fetchImpl,
        });

        resolveResponse(
            new Response(
                JSON.stringify({
                    ok: true,
                    article_id: "article-1",
                    liked: false,
                }),
            ),
        );

        await expect(firstRequest).resolves.toBe(false);
        await expect(secondRequest).resolves.toBe(false);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("未登录时不会发起 viewer like 请求", async () => {
        const fetchImpl = vi.fn();

        const result = await loadArticleViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: {
                userId: "",
                username: "",
                isAdmin: false,
                isLoggedIn: false,
            },
            fetchImpl,
        });

        expect(result).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
