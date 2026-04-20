import { describe, expect, it, vi } from "vitest";

import {
    DETAIL_PAGE_PRIVATE_CACHE_CONTROL,
    DETAIL_PAGE_PUBLIC_CACHE_CONTROL,
    resolveDetailPageAccess,
    resolveDetailPageCacheControl,
} from "@/server/application/public/detail-page-access.service";

type MockDetail = {
    id: string;
    author_id: string;
    title: string;
};

function createDetail(overrides: Partial<MockDetail> = {}): MockDetail {
    return {
        id: "detail-1",
        author_id: "author-1",
        title: "详情",
        ...overrides,
    };
}

describe("detail-page-access.service", () => {
    it("公开详情命中时不会读取 session 或 owner fallback", async () => {
        const loadSessionUser = vi.fn();
        const getSessionAccessToken = vi.fn();
        const loadOwnerDetail = vi.fn();

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            loadPublicDetail: vi.fn().mockResolvedValue(createDetail()),
            loadSessionUser,
            getSessionAccessToken,
            loadOwnerDetail,
        });

        expect(result).toMatchObject({
            mode: "public",
            cacheScope: "public",
            sessionUserId: null,
        });
        expect(loadSessionUser).not.toHaveBeenCalled();
        expect(getSessionAccessToken).not.toHaveBeenCalled();
        expect(loadOwnerDetail).not.toHaveBeenCalled();
    });

    it("保存后新鲜读取优先使用 owner 直读详情", async () => {
        const loadPublicDetail = vi.fn().mockResolvedValue(
            createDetail({
                title: "旧标题",
            }),
        );
        const loadOwnerDetail = vi.fn().mockResolvedValue(
            createDetail({
                title: "新标题",
            }),
        );

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            preferOwner: true,
            loadPublicDetail,
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail,
        });

        expect(result).toMatchObject({
            mode: "owner",
            cacheScope: "private",
            detail: {
                title: "新标题",
            },
            sessionUserId: "author-1",
        });
        expect(loadPublicDetail).not.toHaveBeenCalled();
    });

    it("保存后新鲜读取 owner 未命中时回退 public 详情", async () => {
        const loadPublicDetail = vi.fn().mockResolvedValue(
            createDetail({
                title: "公开标题",
            }),
        );

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            preferOwner: true,
            loadPublicDetail,
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(null),
        });

        expect(result).toMatchObject({
            mode: "public",
            cacheScope: "public",
            detail: {
                title: "公开标题",
            },
        });
        expect(loadPublicDetail).toHaveBeenCalledWith("post-1");
    });

    it("保存后新鲜读取 owner 不属于当前用户时回退 public 详情", async () => {
        const loadPublicDetail = vi.fn().mockResolvedValue(
            createDetail({
                title: "公开标题",
            }),
        );

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            preferOwner: true,
            loadPublicDetail,
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "viewer-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(createDetail()),
        });

        expect(result).toMatchObject({
            mode: "public",
            cacheScope: "public",
            detail: {
                title: "公开标题",
            },
        });
        expect(loadPublicDetail).toHaveBeenCalledWith("post-1");
    });

    it("普通详情请求保持 public-first 行为", async () => {
        const loadOwnerDetail = vi.fn();

        const result = await resolveDetailPageAccess({
            routeId: "post-1",
            loadPublicDetail: vi.fn().mockResolvedValue(
                createDetail({
                    title: "公开标题",
                }),
            ),
            loadSessionUser: vi.fn(),
            getSessionAccessToken: vi.fn(),
            loadOwnerDetail,
        });

        expect(result).toMatchObject({
            mode: "public",
            cacheScope: "public",
            detail: {
                title: "公开标题",
            },
        });
        expect(loadOwnerDetail).not.toHaveBeenCalled();
    });

    it("公开未命中且作者本人回退命中时返回 owner 模式", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(
                createDetail({
                    id: "draft-1",
                }),
            ),
        });

        expect(result).toMatchObject({
            mode: "owner",
            cacheScope: "private",
            sessionUserId: "author-1",
        });
    });

    it("公开未命中且未登录时返回 public 404", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue(null),
            getSessionAccessToken: vi.fn(),
            loadOwnerDetail: vi.fn(),
        });

        expect(result).toEqual({
            mode: "not_found",
            cacheScope: "public",
            sessionUserId: null,
        });
    });

    it("读取到 session 但没有 access token 时返回 private 404", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue(""),
            loadOwnerDetail: vi.fn(),
        });

        expect(result).toEqual({
            mode: "not_found",
            cacheScope: "private",
            sessionUserId: "author-1",
        });
    });

    it("owner fallback 未命中时返回 private 404", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "author-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(null),
        });

        expect(result).toEqual({
            mode: "not_found",
            cacheScope: "private",
            sessionUserId: "author-1",
        });
    });

    it("owner 详情不是当前用户时返回 not_found", async () => {
        const result = await resolveDetailPageAccess({
            routeId: "draft-1",
            loadPublicDetail: vi.fn().mockResolvedValue(null),
            loadSessionUser: vi.fn().mockResolvedValue({
                id: "viewer-1",
            }),
            getSessionAccessToken: vi.fn().mockReturnValue("token"),
            loadOwnerDetail: vi.fn().mockResolvedValue(
                createDetail({
                    author_id: "author-1",
                }),
            ),
        });

        expect(result).toEqual({
            mode: "not_found",
            cacheScope: "private",
            sessionUserId: "viewer-1",
        });
    });

    it("缓存头按 cache scope 区分 public/private 404，并忽略 500", () => {
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 200,
                cacheScope: "private",
            }),
        ).toBe(DETAIL_PAGE_PRIVATE_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 200,
                cacheScope: "public",
            }),
        ).toBe(DETAIL_PAGE_PUBLIC_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 404,
                cacheScope: "public",
            }),
        ).toBe(DETAIL_PAGE_PUBLIC_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 404,
                cacheScope: "private",
            }),
        ).toBe(DETAIL_PAGE_PRIVATE_CACHE_CONTROL);
        expect(
            resolveDetailPageCacheControl({
                responseStatus: 500,
                cacheScope: "public",
            }),
        ).toBeNull();
    });
});
