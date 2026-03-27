import type { JsonObject } from "@/types/json";
import { isSiteAdminRoleName } from "@/server/auth/directus-access";
import {
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import { buildHomeFeed } from "@/server/recommendation/home-feed";
import type {
    HomeFeedItem,
    HomeFeedPageItem,
    HomeFeedPageResponse,
    HomeFeedViewerState,
} from "@/server/recommendation/home-feed.types";

/**
 * 首页首屏固定收敛到 10 条；公共 API 默认分页继续保持 20，避免影响既有调用方。
 */
export const HOME_FEED_HOME_PAGE_LIMIT = 10;
export const DEFAULT_HOME_FEED_PAGE_LIMIT = 20;
export const MAX_HOME_FEED_PAGE_LIMIT = 20;
export const DEFAULT_HOME_FEED_TOTAL_LIMIT = 60;

export type HomeFeedPageInput = {
    viewerId?: string | null;
    viewerRoleName?: string | null;
    isViewerSystemAdmin?: boolean;
    offset: number;
    pageLimit: number;
    totalLimit: number;
};

type ViewerFeedRelations = {
    articleLikedIds: Set<string>;
    diaryLikedIds: Set<string>;
    blockedAuthorIds: Set<string>;
};

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function buildDefaultViewerState(): HomeFeedViewerState {
    return {
        hasLiked: false,
        canDeleteOwn: false,
        canDeleteAdmin: false,
        canBlock: false,
    };
}

function resolveItemRelationId(item: HomeFeedItem): string {
    if (item.type === "article") {
        return (
            normalizeIdentity(item.entry.data.article_id) ||
            normalizeIdentity(item.id)
        );
    }
    return normalizeIdentity(item.entry.id) || normalizeIdentity(item.id);
}

function resolveViewerAdminState(input: HomeFeedPageInput): boolean {
    return Boolean(
        input.isViewerSystemAdmin || isSiteAdminRoleName(input.viewerRoleName),
    );
}

async function loadViewerFeedRelations(params: {
    viewerId: string;
    authorIds: string[];
    articleIds: string[];
    diaryIds: string[];
}): Promise<ViewerFeedRelations> {
    const [articleLikeRows, diaryLikeRows, blockedRows] =
        await runWithDirectusServiceAccess(
            async () =>
                await Promise.all([
                    params.articleIds.length > 0
                        ? readMany("app_article_likes", {
                              filter: {
                                  _and: [
                                      { user_id: { _eq: params.viewerId } },
                                      {
                                          article_id: {
                                              _in: params.articleIds,
                                          },
                                      },
                                      { status: { _eq: "published" } },
                                  ],
                              } as JsonObject,
                              fields: ["article_id"],
                              limit: params.articleIds.length,
                          })
                        : Promise.resolve([]),
                    params.diaryIds.length > 0
                        ? readMany("app_diary_likes", {
                              filter: {
                                  _and: [
                                      { user_id: { _eq: params.viewerId } },
                                      { diary_id: { _in: params.diaryIds } },
                                      { status: { _eq: "published" } },
                                  ],
                              } as JsonObject,
                              fields: ["diary_id"],
                              limit: params.diaryIds.length,
                          })
                        : Promise.resolve([]),
                    params.authorIds.length > 0
                        ? readMany("app_user_blocks", {
                              filter: {
                                  _and: [
                                      { blocker_id: { _eq: params.viewerId } },
                                      {
                                          blocked_user_id: {
                                              _in: params.authorIds,
                                          },
                                      },
                                      { status: { _eq: "published" } },
                                  ],
                              } as JsonObject,
                              fields: ["blocked_user_id"],
                              limit: params.authorIds.length,
                          })
                        : Promise.resolve([]),
                ]),
        );

    return {
        articleLikedIds: new Set(
            articleLikeRows
                .map((row) => normalizeIdentity(row.article_id))
                .filter(Boolean),
        ),
        diaryLikedIds: new Set(
            diaryLikeRows
                .map((row) => normalizeIdentity(row.diary_id))
                .filter(Boolean),
        ),
        blockedAuthorIds: new Set(
            blockedRows
                .map((row) => normalizeIdentity(row.blocked_user_id))
                .filter(Boolean),
        ),
    };
}

function attachViewerStateToItem(params: {
    item: HomeFeedItem;
    viewerId: string | null;
    isViewerAdmin: boolean;
    relations: ViewerFeedRelations;
}): HomeFeedPageItem {
    if (!params.viewerId) {
        return {
            ...params.item,
            viewerState: buildDefaultViewerState(),
        };
    }

    const isOwner = normalizeIdentity(params.item.authorId) === params.viewerId;
    const relationId = resolveItemRelationId(params.item);
    const hasLiked =
        params.item.type === "article"
            ? params.relations.articleLikedIds.has(relationId)
            : params.relations.diaryLikedIds.has(relationId);

    return {
        ...params.item,
        viewerState: {
            hasLiked,
            canDeleteOwn: isOwner,
            canDeleteAdmin: params.isViewerAdmin && !isOwner,
            canBlock:
                !isOwner &&
                !params.relations.blockedAuthorIds.has(
                    normalizeIdentity(params.item.authorId),
                ),
        },
    };
}

/**
 * 首页 feed 的分页切片逻辑收敛到应用层，路由只负责解析请求参数。
 */
export async function buildHomeFeedPage(
    input: HomeFeedPageInput,
): Promise<HomeFeedPageResponse> {
    const feed = await buildHomeFeed({
        limit: input.totalLimit,
    });
    const normalizedViewerId = normalizeIdentity(input.viewerId);
    const isViewerAdmin = resolveViewerAdminState(input);
    const authorIds = Array.from(
        new Set(
            feed.items
                .map((item) => normalizeIdentity(item.authorId))
                .filter(Boolean),
        ),
    );
    const blockRelations = normalizedViewerId
        ? await loadViewerFeedRelations({
              viewerId: normalizedViewerId,
              authorIds,
              articleIds: [],
              diaryIds: [],
          })
        : {
              articleLikedIds: new Set<string>(),
              diaryLikedIds: new Set<string>(),
              blockedAuthorIds: new Set<string>(),
          };
    const visibleItems = blockRelations.blockedAuthorIds.size
        ? feed.items.filter(
              (item) =>
                  !blockRelations.blockedAuthorIds.has(
                      normalizeIdentity(item.authorId),
                  ),
          )
        : feed.items;
    const slicedItems = visibleItems.slice(
        input.offset,
        input.offset + input.pageLimit,
    );
    const relationIds = {
        articleIds: slicedItems
            .filter(
                (item): item is HomeFeedItem & { type: "article" } =>
                    item.type === "article",
            )
            .map((item) => resolveItemRelationId(item))
            .filter(Boolean),
        diaryIds: slicedItems
            .filter(
                (item): item is HomeFeedItem & { type: "diary" } =>
                    item.type === "diary",
            )
            .map((item) => resolveItemRelationId(item))
            .filter(Boolean),
    };
    const viewerRelations = normalizedViewerId
        ? await loadViewerFeedRelations({
              viewerId: normalizedViewerId,
              authorIds: [],
              articleIds: relationIds.articleIds,
              diaryIds: relationIds.diaryIds,
          })
        : blockRelations;
    const items = slicedItems.map((item) =>
        attachViewerStateToItem({
            item,
            viewerId: normalizedViewerId || null,
            isViewerAdmin,
            relations: {
                ...viewerRelations,
                blockedAuthorIds: blockRelations.blockedAuthorIds,
            },
        }),
    );
    const nextOffset = input.offset + items.length;

    return {
        items,
        offset: input.offset,
        limit: input.pageLimit,
        next_offset: nextOffset,
        has_more: nextOffset < visibleItems.length,
        generated_at: feed.generatedAt,
        total: visibleItems.length,
    };
}
