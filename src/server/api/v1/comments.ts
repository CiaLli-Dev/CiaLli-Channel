import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import {
    countItems,
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { cacheManager } from "@/server/cache/manager";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    CommentPreviewSchema,
    CreateCommentSchema,
    UpdateCommentSchema,
} from "@/server/api/schemas";

import {
    buildCommentTree,
    DIARY_FIELDS,
    invalidateArticleInteractionAggregate,
    parseRouteId,
    requireAccess,
} from "./shared";
import type { CommentRecord, CommentTreeNode } from "./shared";
import { getAuthorBundle } from "./shared/author-cache";
import {
    cleanupOrphanDirectusFiles,
    extractDirectusFileIdsFromUnknown,
} from "./shared/file-cleanup";

type CommentPermissionKey = "can_comment_articles" | "can_comment_diaries";
type CommentCollection = "app_article_comments" | "app_diary_comments";
type CommentLikeCollection =
    | "app_article_comment_likes"
    | "app_diary_comment_likes";
type CommentLikeField = "article_comment_id" | "diary_comment_id";
type CommentRelationField = "article_id" | "diary_id";

const COMMENT_PAGE_SIZE_DEFAULT = 20;
const COMMENT_PAGE_SIZE_MAX = 50;

export function canCreateReplyAtDepth(parentDepth: number): boolean {
    return parentDepth < 2;
}

export function parseCommentPagination(url: URL): {
    page: number;
    limit: number;
    offset: number;
} {
    const pageRaw = Number(url.searchParams.get("page") || "1");
    const limitRaw = Number(
        url.searchParams.get("limit") || String(COMMENT_PAGE_SIZE_DEFAULT),
    );
    const page =
        Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(COMMENT_PAGE_SIZE_MAX, Math.floor(limitRaw))
            : COMMENT_PAGE_SIZE_DEFAULT;
    return {
        page,
        limit,
        offset: (page - 1) * limit,
    };
}

function resolveCommentLikeField(
    collection: CommentLikeCollection,
): CommentLikeField {
    return collection === "app_article_comment_likes"
        ? "article_comment_id"
        : "diary_comment_id";
}

async function resolveCommentDepth(
    collection: CommentCollection,
    commentId: string,
): Promise<number | null> {
    let depth = 0;
    let currentId = String(commentId || "").trim();
    const visited = new Set<string>();

    while (currentId) {
        if (visited.has(currentId)) {
            return null;
        }
        visited.add(currentId);
        const comment = await readOneById(collection, currentId, {
            fields: ["id", "parent_id"],
        });
        if (!comment) {
            return null;
        }
        const parentId = String(comment.parent_id || "").trim();
        if (!parentId) {
            return depth;
        }
        depth += 1;
        currentId = parentId;
    }

    return null;
}

async function loadCommentLikeStats(
    collection: CommentLikeCollection,
    commentIds: string[],
    viewerId: string | null,
): Promise<{ countMap: Map<string, number>; likedByViewer: Set<string> }> {
    const countMap = new Map<string, number>();
    const likedByViewer = new Set<string>();
    if (commentIds.length === 0) {
        return { countMap, likedByViewer };
    }

    const likeField = resolveCommentLikeField(collection);
    const likes = (await readMany(collection, {
        filter: {
            _and: [
                { [likeField]: { _in: commentIds } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        fields: [likeField, "user_id"],
        limit: -1,
    })) as Array<Record<string, unknown>>;

    for (const like of likes) {
        const targetId = String(like[likeField] || "").trim();
        if (!targetId) {
            continue;
        }
        countMap.set(targetId, (countMap.get(targetId) || 0) + 1);
        if (viewerId && String(like.user_id || "").trim() === viewerId) {
            likedByViewer.add(targetId);
        }
    }

    return { countMap, likedByViewer };
}

function applyLikeStatsToCommentNode(
    node: CommentTreeNode,
    countMap: Map<string, number>,
    likedByViewer: Set<string>,
): CommentTreeNode {
    const replies = (node.replies || []).map((reply) =>
        applyLikeStatsToCommentNode(reply, countMap, likedByViewer),
    );
    const id = String(node.id || "").trim();
    return {
        ...node,
        like_count: countMap.get(id) || 0,
        liked_by_viewer: likedByViewer.has(id),
        replies,
    };
}

function applyLikeStatsToCommentTree(
    tree: CommentTreeNode[],
    countMap: Map<string, number>,
    likedByViewer: Set<string>,
): CommentTreeNode[] {
    return tree.map((node) =>
        applyLikeStatsToCommentNode(node, countMap, likedByViewer),
    );
}

function invalidateDiaryDetailCache(id: string, shortId?: string | null): void {
    void cacheManager.invalidate("diary-detail", id);
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        void cacheManager.invalidate("diary-detail", normalizedShortId);
    }
}

async function invalidateDiaryDetailCacheByDiaryId(
    diaryId: string,
): Promise<void> {
    const diary = await readOneById("app_diaries", diaryId, {
        fields: ["id", "short_id"],
    });
    if (!diary) {
        invalidateDiaryDetailCache(diaryId);
        return;
    }
    invalidateDiaryDetailCache(String(diary.id), diary.short_id);
}

async function collectDescendantCommentIds(
    collection: CommentCollection,
    rootId: string,
): Promise<Array<{ id: string; body?: unknown }>> {
    const visited = new Set<string>([rootId]);
    const descendants: Array<{ id: string; body?: unknown }> = [];
    let frontier: string[] = [rootId];

    while (frontier.length > 0) {
        const children = await readMany(collection, {
            filter: {
                parent_id: { _in: frontier },
            } as JsonObject,
            fields: ["id", "body"],
            limit: -1,
        });

        const nextFrontier: string[] = [];
        for (const child of children) {
            const childId = String(child.id || "");
            if (!childId || visited.has(childId)) {
                continue;
            }
            visited.add(childId);
            descendants.push({
                id: childId,
                body: child.body,
            });
            nextFrontier.push(childId);
        }
        frontier = nextFrontier;
    }

    return descendants;
}

async function deleteCommentWithDescendants(
    collection: CommentCollection,
    commentId: string,
): Promise<void> {
    const descendants = await collectDescendantCommentIds(
        collection,
        commentId,
    );
    const rootComment = await readOneById(collection, commentId, {
        fields: ["id", "body"],
    });
    const candidateFileIds = new Set<string>();
    if (rootComment) {
        for (const fileId of extractDirectusFileIdsFromUnknown(
            rootComment.body,
        )) {
            candidateFileIds.add(fileId);
        }
    }
    for (const descendant of descendants) {
        for (const fileId of extractDirectusFileIdsFromUnknown(
            descendant.body,
        )) {
            candidateFileIds.add(fileId);
        }
    }

    for (const descendant of descendants.reverse()) {
        await deleteOne(collection, descendant.id);
    }
    await deleteOne(collection, commentId);
    await cleanupOrphanDirectusFiles([...candidateFileIds]);
}

async function renderCommentBodyHtml(
    markdown: string,
    mode: MarkdownRenderMode = "full",
    options?: {
        allowBlobImages?: boolean;
    },
): Promise<string> {
    const source = String(markdown || "");
    if (!source.trim()) {
        return "";
    }
    try {
        return await renderMarkdown(source, {
            target: "page",
            mode,
            allowBlobImages: options?.allowBlobImages ?? false,
        });
    } catch (error) {
        console.error("[comments] markdown render failed:", error);
        return "";
    }
}

async function decorateCommentNodeWithHtml(
    node: CommentTreeNode,
): Promise<CommentTreeNode> {
    const replies = await Promise.all(
        (node.replies || []).map((reply) => decorateCommentNodeWithHtml(reply)),
    );
    return {
        ...node,
        body_html: await renderCommentBodyHtml(node.body),
        replies,
    };
}

async function decorateCommentTreeWithHtml(
    tree: CommentTreeNode[],
): Promise<CommentTreeNode[]> {
    return await Promise.all(
        tree.map((comment) => decorateCommentNodeWithHtml(comment)),
    );
}

type EditableCommentInput = {
    body?: string;
    status?: string;
    is_public?: boolean;
    show_on_profile?: boolean;
};

function buildCommentUpdatePayload(input: EditableCommentInput): JsonObject {
    const payload: JsonObject = {};
    if (input.body !== undefined) {
        payload.body = input.body;
    }
    if (input.status !== undefined) {
        payload.status = input.status;
    }
    if (input.is_public !== undefined) {
        payload.is_public = input.is_public;
    }
    if (input.show_on_profile !== undefined) {
        payload.show_on_profile = input.show_on_profile;
    }
    return payload;
}

async function buildDecoratedCommentTree(
    context: APIContext,
    comments: CommentRecord[],
    likeCollection: CommentLikeCollection,
    scope: "article" | "diary",
): Promise<CommentTreeNode[]> {
    const authorIds = Array.from(
        new Set(comments.map((item) => item.author_id)),
    );
    const authorMap = await getAuthorBundle(authorIds);
    const commentIds = comments
        .map((item) => String(item.id || "").trim())
        .filter(Boolean);
    const viewer = await getSessionUser(context).catch((error) => {
        console.warn(
            `[comments] get session for ${scope} comments failed:`,
            error,
        );
        return null;
    });
    const likeStats = await loadCommentLikeStats(
        likeCollection,
        commentIds,
        viewer?.id ?? null,
    );
    return await decorateCommentTreeWithHtml(
        applyLikeStatsToCommentTree(
            buildCommentTree(comments, authorMap),
            likeStats.countMap,
            likeStats.likedByViewer,
        ),
    );
}

async function loadPaginatedComments(
    collection: CommentCollection,
    relationField: CommentRelationField,
    relationId: string,
    pagination: { page: number; limit: number; offset: number },
): Promise<{
    comments: CommentRecord[];
    page: number;
    limit: number;
    totalTopLevel: number;
    hasMore: boolean;
}> {
    const baseFilters: JsonObject[] = [
        { [relationField]: { _eq: relationId } },
        { status: { _eq: "published" } },
        { is_public: { _eq: true } },
    ];
    const topLevelFilter = {
        _and: [...baseFilters, { parent_id: { _null: true } }],
    } as JsonObject;

    const [topLevelRows, totalTopLevel] = await Promise.all([
        readMany(collection, {
            filter: topLevelFilter,
            sort: ["date_created"],
            limit: pagination.limit,
            offset: pagination.offset,
        }) as Promise<CommentRecord[]>,
        countItems(collection, topLevelFilter),
    ]);

    const topLevelIds = topLevelRows
        .map((item) => String(item.id || "").trim())
        .filter(Boolean);
    if (topLevelIds.length === 0) {
        return {
            comments: [],
            page: pagination.page,
            limit: pagination.limit,
            totalTopLevel,
            hasMore: pagination.offset < totalTopLevel,
        };
    }

    const levelOneRows = (await readMany(collection, {
        filter: {
            _and: [...baseFilters, { parent_id: { _in: topLevelIds } }],
        } as JsonObject,
        sort: ["date_created"],
        limit: -1,
    })) as CommentRecord[];
    const levelOneIds = levelOneRows
        .map((item) => String(item.id || "").trim())
        .filter(Boolean);

    let levelTwoRows: CommentRecord[] = [];
    if (levelOneIds.length > 0) {
        levelTwoRows = (await readMany(collection, {
            filter: {
                _and: [...baseFilters, { parent_id: { _in: levelOneIds } }],
            } as JsonObject,
            sort: ["date_created"],
            limit: -1,
        })) as CommentRecord[];
    }

    return {
        comments: [...topLevelRows, ...levelOneRows, ...levelTwoRows],
        page: pagination.page,
        limit: pagination.limit,
        totalTopLevel,
        hasMore: pagination.offset + topLevelRows.length < totalTopLevel,
    };
}

async function renderCommentItem<T extends Record<string, unknown>>(
    item: T,
): Promise<T & { body: string; body_html: string }> {
    const body = String(item.body || "");
    return {
        ...item,
        body,
        body_html: await renderCommentBodyHtml(body),
    };
}

async function validateReplyParent(
    collection: CommentCollection,
    parentId: string,
    entityId: string,
    relationKey: "article_id" | "diary_id",
): Promise<Response | null> {
    const parent = await readOneById(collection, parentId);
    const relationValue = String(
        (parent as Record<string, unknown> | null)?.[relationKey] || "",
    );
    if (!parent || relationValue !== entityId) {
        return fail("父评论不存在", 404);
    }

    const parentDepth = await resolveCommentDepth(collection, parent.id);
    if (parentDepth === null) {
        return fail("父评论不存在", 404);
    }
    if (!canCreateReplyAtDepth(parentDepth)) {
        return fail("最多支持三级回复", 400);
    }

    return null;
}

async function handleCommentPreview(
    context: APIContext,
    permission: CommentPermissionKey,
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    assertCan(access, permission);

    const body = await parseJsonBody(context.request);
    const input = validateBody(CommentPreviewSchema, body);
    const renderStart = performance.now();
    const bodyHtml = await renderCommentBodyHtml(
        input.body,
        input.render_mode,
        {
            // 仅评论预览放开 blob，落库/展示链路仍走严格策略。
            allowBlobImages: true,
        },
    );
    const renderDuration = performance.now() - renderStart;
    return ok(
        {
            body: input.body,
            body_html: bodyHtml,
        },
        {
            headers:
                process.env.NODE_ENV === "production"
                    ? undefined
                    : {
                          "Server-Timing": `md-render;dur=${renderDuration.toFixed(2)};desc="${input.render_mode}"`,
                      },
        },
    );
}

async function handleArticleComments(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (
        segments.length === 3 &&
        segments[1] === "comments" &&
        segments[2] === "preview"
    ) {
        return await handleCommentPreview(context, "can_comment_articles");
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const articleId = parseRouteId(segments[1]);
        if (!articleId) {
            return fail("缺少文章 ID", 400);
        }

        if (context.request.method === "GET") {
            const article = await readOneById("app_articles", articleId);
            if (!article) {
                return fail("文章不存在", 404);
            }
            if (!(article.status === "published" && article.is_public)) {
                return fail("文章不可见", 404);
            }

            // 评论分页以顶层评论为基准，避免一次性全量读取。
            const pagination = parseCommentPagination(context.url);
            const pagedComments = await loadPaginatedComments(
                "app_article_comments",
                "article_id",
                articleId,
                pagination,
            );

            const tree = await buildDecoratedCommentTree(
                context,
                pagedComments.comments,
                "app_article_comment_likes",
                "article",
            );
            return ok({
                items: tree,
                total: pagedComments.totalTopLevel,
                total_top_level: pagedComments.totalTopLevel,
                page: pagedComments.page,
                limit: pagedComments.limit,
                has_more: pagedComments.hasMore,
            });
        }

        if (context.request.method === "POST") {
            const required = await requireAccess(context);
            if ("response" in required) {
                return required.response;
            }
            const access = required.access;
            assertCan(access, "can_comment_articles");

            const article = await readOneById("app_articles", articleId);
            if (!article) {
                return fail("文章不存在", 404);
            }
            if (!article.allow_comments) {
                return fail("该文章已关闭评论", 403);
            }

            const body = await parseJsonBody(context.request);
            const input = validateBody(CreateCommentSchema, body);
            if (input.parent_id) {
                const parentValidationError = await validateReplyParent(
                    "app_article_comments",
                    input.parent_id,
                    articleId,
                    "article_id",
                );
                if (parentValidationError) {
                    return parentValidationError;
                }
            }

            const created = await createOne("app_article_comments", {
                status: input.status,
                article_id: articleId,
                author_id: access.user.id,
                parent_id: input.parent_id,
                body: input.body,
                is_public: input.is_public,
                show_on_profile: input.show_on_profile,
            });
            void cacheManager.invalidate("article-detail", articleId);
            invalidateArticleInteractionAggregate(articleId);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({
                item: await renderCommentItem(created),
            });
        }
    }

    if (segments.length === 3 && segments[1] === "comments") {
        const commentId = parseRouteId(segments[2]);
        if (!commentId) {
            return fail("缺少评论 ID", 400);
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        const access = required.access;
        const comment = await readOneById("app_article_comments", commentId);
        if (!comment) {
            return fail("评论不存在", 404);
        }
        assertOwnerOrAdmin(access, comment.author_id);

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateCommentSchema, body);
            const payload = buildCommentUpdatePayload(input);
            const updated = await updateOne(
                "app_article_comments",
                commentId,
                payload,
            );
            void cacheManager.invalidate("article-detail", comment.article_id);
            invalidateArticleInteractionAggregate(comment.article_id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({
                item: await renderCommentItem(updated),
            });
        }

        if (context.request.method === "DELETE") {
            await deleteCommentWithDescendants(
                "app_article_comments",
                commentId,
            );
            void cacheManager.invalidate("article-detail", comment.article_id);
            invalidateArticleInteractionAggregate(comment.article_id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ id: commentId });
        }
    }

    return fail("未找到接口", 404);
}

async function handleDiaryComments(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (
        segments.length === 3 &&
        segments[1] === "comments" &&
        segments[2] === "preview"
    ) {
        return await handleCommentPreview(context, "can_comment_diaries");
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const diaryId = parseRouteId(segments[1]);
        if (!diaryId) {
            return fail("缺少日记 ID", 400);
        }

        if (context.request.method === "GET") {
            const diary = await readOneById("app_diaries", diaryId, {
                fields: [...DIARY_FIELDS],
            });
            if (!diary) {
                return fail("日记不存在", 404);
            }
            if (!(diary.status === "published" && diary.praviate === true)) {
                return fail("日记不可见", 404);
            }

            // 评论分页以顶层评论为基准，避免一次性全量读取。
            const pagination = parseCommentPagination(context.url);
            const pagedComments = await loadPaginatedComments(
                "app_diary_comments",
                "diary_id",
                diaryId,
                pagination,
            );

            const tree = await buildDecoratedCommentTree(
                context,
                pagedComments.comments,
                "app_diary_comment_likes",
                "diary",
            );
            return ok({
                items: tree,
                total: pagedComments.totalTopLevel,
                total_top_level: pagedComments.totalTopLevel,
                page: pagedComments.page,
                limit: pagedComments.limit,
                has_more: pagedComments.hasMore,
            });
        }

        if (context.request.method === "POST") {
            const required = await requireAccess(context);
            if ("response" in required) {
                return required.response;
            }
            const access = required.access;
            assertCan(access, "can_comment_diaries");

            const diary = await readOneById("app_diaries", diaryId, {
                fields: [...DIARY_FIELDS],
            });
            if (!diary) {
                return fail("日记不存在", 404);
            }
            if (!diary.allow_comments) {
                return fail("该日记已关闭评论", 403);
            }

            const body = await parseJsonBody(context.request);
            const input = validateBody(CreateCommentSchema, body);
            if (input.parent_id) {
                const parentValidationError = await validateReplyParent(
                    "app_diary_comments",
                    input.parent_id,
                    diaryId,
                    "diary_id",
                );
                if (parentValidationError) {
                    return parentValidationError;
                }
            }

            const created = await createOne("app_diary_comments", {
                status: input.status,
                diary_id: diaryId,
                author_id: access.user.id,
                parent_id: input.parent_id,
                body: input.body,
                is_public: input.is_public,
                show_on_profile: input.show_on_profile,
            });
            invalidateDiaryDetailCache(String(diary.id), diary.short_id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({
                item: await renderCommentItem(created),
            });
        }
    }

    if (segments.length === 3 && segments[1] === "comments") {
        const commentId = parseRouteId(segments[2]);
        if (!commentId) {
            return fail("缺少评论 ID", 400);
        }
        const required = await requireAccess(context);
        if ("response" in required) {
            return required.response;
        }
        const access = required.access;
        const comment = await readOneById("app_diary_comments", commentId);
        if (!comment) {
            return fail("评论不存在", 404);
        }
        assertOwnerOrAdmin(access, comment.author_id);

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateCommentSchema, body);
            const payload = buildCommentUpdatePayload(input);
            const updated = await updateOne(
                "app_diary_comments",
                commentId,
                payload,
            );
            await invalidateDiaryDetailCacheByDiaryId(comment.diary_id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({
                item: await renderCommentItem(updated),
            });
        }

        if (context.request.method === "DELETE") {
            await deleteCommentWithDescendants("app_diary_comments", commentId);
            await invalidateDiaryDetailCacheByDiaryId(comment.diary_id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ id: commentId });
        }
    }

    return fail("未找到接口", 404);
}

export { handleArticleComments, handleDiaryComments };
