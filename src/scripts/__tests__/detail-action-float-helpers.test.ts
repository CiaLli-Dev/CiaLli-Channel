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
    loadViewerLikeState,
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

        const result = await loadViewerLikeState({
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
        const firstRequest = loadViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: state,
            fetchImpl,
        });
        const secondRequest = loadViewerLikeState({
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

    it("首个请求完成后再次进入详情页会重新同步最新 liked 状态", async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ok: true,
                        article_id: "article-1",
                        liked: false,
                    }),
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ok: true,
                        article_id: "article-1",
                        liked: true,
                    }),
                ),
            );

        const first = await loadViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: createLoggedInState(),
            fetchImpl,
        });
        const second = await loadViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: createLoggedInState(),
            fetchImpl,
        });

        expect(first).toBe(false);
        expect(second).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("失败请求结束后会清理单飞缓存，后续调用可以重试", async () => {
        const fetchImpl = vi
            .fn()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ok: true,
                        article_id: "article-1",
                        liked: true,
                    }),
                ),
            );

        const first = await loadViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: createLoggedInState(),
            fetchImpl,
        });
        const second = await loadViewerLikeState({
            contentType: "article",
            contentId: "article-1",
            authState: createLoggedInState(),
            fetchImpl,
        });

        expect(first).toBe(false);
        expect(second).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("未登录时不会发起 viewer like 请求", async () => {
        const fetchImpl = vi.fn();

        const result = await loadViewerLikeState({
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

    it("日记详情会命中 diary likes state 接口", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ok: true,
                    diary_id: "diary-1",
                    liked: true,
                }),
            ),
        );

        const result = await loadViewerLikeState({
            contentType: "diary",
            contentId: "diary-1",
            authState: createLoggedInState(),
            fetchImpl,
        });

        expect(result).toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith(
            "/api/v1/me/diary-likes/state/diary-1",
            expect.objectContaining({
                method: "GET",
                cache: "no-store",
            }),
        );
    });
});
