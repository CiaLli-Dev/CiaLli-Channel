export const DETAIL_PAGE_PUBLIC_CACHE_CONTROL =
    "public, s-maxage=60, stale-while-revalidate=300";
export const DETAIL_PAGE_PRIVATE_CACHE_CONTROL = "private, no-store";

export type DetailPageCacheScope = "public" | "private";

type SessionUser = {
    id: string;
};

export type DetailPageMode = "public" | "owner";

export type DetailPageAccessResolution<T extends { author_id: string }> =
    | {
          mode: DetailPageMode;
          cacheScope: DetailPageCacheScope;
          detail: T;
          sessionUserId: string | null;
      }
    | {
          mode: "not_found";
          cacheScope: DetailPageCacheScope;
          sessionUserId: string | null;
      };

type ResolveDetailPageAccessInput<T extends { author_id: string }> = {
    routeId: string;
    loadPublicDetail: (routeId: string) => Promise<T | null>;
    loadSessionUser: () => Promise<SessionUser | null>;
    getSessionAccessToken: () => string;
    loadOwnerDetail: (
        routeId: string,
        accessToken: string,
        sessionUserId: string,
    ) => Promise<T | null>;
};

export async function resolveDetailPageAccess<T extends { author_id: string }>(
    input: ResolveDetailPageAccessInput<T>,
): Promise<DetailPageAccessResolution<T>> {
    const publicDetail = await input.loadPublicDetail(input.routeId);
    if (publicDetail) {
        return {
            mode: "public",
            cacheScope: "public",
            detail: publicDetail,
            sessionUserId: null,
        };
    }

    // 仅在公开快照未命中时才读取会话；一旦进入该分支，结果就不再适合共享缓存。
    const sessionUser = await input.loadSessionUser();
    if (!sessionUser) {
        return {
            mode: "not_found",
            cacheScope: "public",
            sessionUserId: null,
        };
    }

    const accessToken = input.getSessionAccessToken();
    if (!accessToken) {
        return {
            mode: "not_found",
            cacheScope: "private",
            sessionUserId: sessionUser.id,
        };
    }

    const ownerDetail = await input.loadOwnerDetail(
        input.routeId,
        accessToken,
        sessionUser.id,
    );
    if (!ownerDetail || ownerDetail.author_id !== sessionUser.id) {
        return {
            mode: "not_found",
            cacheScope: "private",
            sessionUserId: sessionUser.id,
        };
    }

    return {
        mode: "owner",
        cacheScope: "private",
        detail: ownerDetail,
        sessionUserId: sessionUser.id,
    };
}

export function resolveDetailPageCacheControl(input: {
    responseStatus: number;
    cacheScope: DetailPageCacheScope;
}): string | null {
    if (input.responseStatus >= 500) {
        return null;
    }
    if (input.cacheScope === "private") {
        return DETAIL_PAGE_PRIVATE_CACHE_CONTROL;
    }
    return DETAIL_PAGE_PUBLIC_CACHE_CONTROL;
}
