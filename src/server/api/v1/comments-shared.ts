import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { CommentStatus } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { assertCan } from "@/server/auth/acl";
import { getSessionUser } from "@/server/auth/session";
import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import {
    countItems,
    countItemsGroupedByField,
    createOne,
    deleteOne,
    readMany,
    readOneById,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { CommentPreviewSchema } from "@/server/api/schemas";

import { buildCommentTree, requireAccess } from "./shared";
import type { CommentRecord, CommentTreeNode } from "./shared";
import { getAuthorBundle } from "./shared/author-cache";
import {
    cleanupOwnedOrphanDirectusFiles,
    extractDirectusAssetIdsFromMarkdown,
} from "./shared/file-cleanup";

export type { CommentRecord, CommentTreeNode };

export type CommentPermissionKey =
    | "can_comment_articles"
    | "can_comment_diaries";
export type CommentCollection = "app_article_comments" | "app_diary_comments";
export type CommentLikeCollection =
    | "app_article_comment_likes"
    | "app_diary_comment_likes";
type CommentLikeField = "article_comment_id" | "diary_comment_id";
export type CommentRelationField = "article_id" | "diary_id";

export type EditableCommentInput = {
    body?: string;
    status?: CommentStatus;
    is_public?: boolean;
    show_on_profile?: boolean;
};

export function buildCommentUpdatePayload(
    input: EditableCommentInput,
): JsonObject {
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

function resolveCommentLikeField(
    collection: CommentLikeCollection,
): CommentLikeField {
    return collection === "app_article_comment_likes"
        ? "article_comment_id"
        : "diary_comment_id";
}

export async function resolveCommentDepth(
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

export function canCreateReplyAtDepth(parentDepth: number): boolean {
    return parentDepth < 2;
}

async function loadCommentLikeStats(
    collection: CommentLikeCollection,
    commentIds: string[],
    viewerId: string | null,
): Promise<{ countMap: Map<string, number>; likedByViewer: Set<string> }> {
    const likedByViewer = new Set<string>();
    if (commentIds.length === 0) {
        return { countMap: new Map(), likedByViewer };
    }

    const likeField = resolveCommentLikeField(collection);
    // 评论点赞总数改为数据库聚合，避免把所有点赞明细拉到应用层再计数。
    const countMap = await countItemsGroupedByField(collection, likeField, {
        _and: [
            { [likeField]: { _in: commentIds } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);

    if (!viewerId) {
        return { countMap, likedByViewer };
    }

    const viewerLikes = (await readMany(collection, {
        filter: {
            _and: [
                { [likeField]: { _in: commentIds } },
                { status: { _eq: "published" } },
                { user_id: { _eq: viewerId } },
            ],
        } as JsonObject,
        fields: [likeField],
        // 仅查询当前查看者点赞关系，查询范围受当前页面 commentIds 限定。
        limit: -1,
    })) as Array<Record<string, unknown>>;

    for (const like of viewerLikes) {
        const targetId = String(like[likeField] || "").trim();
        if (targetId) {
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

export async function buildDecoratedCommentTree(
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

export async function loadPaginatedComments(
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

export async function renderCommentItem<T extends Record<string, unknown>>(
    item: T,
): Promise<T & { body: string; body_html: string }> {
    const body = String(item.body || "");
    return {
        ...item,
        body,
        body_html: await renderCommentBodyHtml(body),
    };
}

export async function validateReplyParent(
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

async function collectDescendantCommentIds(
    collection: CommentCollection,
    rootId: string,
): Promise<Array<{ id: string; body?: unknown; author_id?: unknown }>> {
    const visited = new Set<string>([rootId]);
    const descendants: Array<{
        id: string;
        body?: unknown;
        author_id?: unknown;
    }> = [];
    let frontier: string[] = [rootId];

    while (frontier.length > 0) {
        const children = await readMany(collection, {
            filter: {
                parent_id: { _in: frontier },
            } as JsonObject,
            fields: ["id", "body", "author_id"],
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
                author_id: child.author_id,
            });
            nextFrontier.push(childId);
        }
        frontier = nextFrontier;
    }

    return descendants;
}

export async function deleteCommentWithDescendants(
    collection: CommentCollection,
    commentId: string,
): Promise<void> {
    const descendants = await collectDescendantCommentIds(
        collection,
        commentId,
    );
    const rootComment = await readOneById(collection, commentId, {
        fields: ["id", "body", "author_id"],
    });
    const candidateFileIds = new Set<string>();
    const ownerUserIds = new Set<string>();
    if (rootComment) {
        const rootAuthorId = String(rootComment.author_id ?? "").trim();
        if (rootAuthorId) {
            ownerUserIds.add(rootAuthorId);
        }
        for (const fileId of extractDirectusAssetIdsFromMarkdown(
            String(rootComment.body ?? ""),
        )) {
            candidateFileIds.add(fileId);
        }
    }
    for (const descendant of descendants) {
        const ownerUserId = String(descendant.author_id ?? "").trim();
        if (ownerUserId) {
            ownerUserIds.add(ownerUserId);
        }
        for (const fileId of extractDirectusAssetIdsFromMarkdown(
            String(descendant.body ?? ""),
        )) {
            candidateFileIds.add(fileId);
        }
    }

    for (const descendant of descendants.reverse()) {
        await deleteOne(collection, descendant.id);
    }
    await deleteOne(collection, commentId);
    await cleanupOwnedOrphanDirectusFiles({
        candidateFileIds: [...candidateFileIds],
        ownerUserIds: [...ownerUserIds],
    });
}

export async function handleCommentPreview(
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

const COMMENT_PAGE_SIZE_DEFAULT = 20;
const COMMENT_PAGE_SIZE_MAX = 50;

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

export function createDiaryComment(
    diaryId: string,
    authorId: string,
    input: {
        status: CommentStatus;
        parent_id?: string | null;
        body: string;
        is_public?: boolean;
        show_on_profile?: boolean;
    },
): ReturnType<typeof createOne> {
    return createOne("app_diary_comments", {
        status: input.status,
        diary_id: diaryId,
        author_id: authorId,
        parent_id: input.parent_id,
        body: input.body,
        is_public: input.is_public,
        show_on_profile: input.show_on_profile,
    });
}
