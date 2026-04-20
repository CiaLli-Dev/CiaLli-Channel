import type { APIContext } from "astro";
import * as z from "zod";

import type { JsonObject } from "@/types/json";
import { assertCan } from "@/server/auth/acl";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    countItems,
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import type { AppAccess } from "@/server/api/v1/shared";
import {
    DIARY_FIELDS,
    invalidateArticleInteractionAggregate,
    invalidateArticleInteractionViewerState,
    invalidateDiaryInteractionAggregate,
    invalidateDiaryInteractionViewerState,
    parseRouteId,
} from "@/server/api/v1/shared";

const ArticleLikeSchema = z.object({
    article_id: z.string().min(1, "缺少文章 ID"),
});

const DiaryLikeSchema = z.object({
    diary_id: z.string().min(1, "缺少日记 ID"),
});

const ArticleCommentLikeSchema = z.object({
    article_comment_id: z.string().min(1, "缺少文章评论 ID"),
});

const DiaryCommentLikeSchema = z.object({
    diary_comment_id: z.string().min(1, "缺少日记评论 ID"),
});

async function getArticleLikeCount(articleId: string): Promise<number> {
    return await countItems("app_article_likes", {
        _and: [
            { article_id: { _eq: articleId } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

async function getDiaryLikeCount(diaryId: string): Promise<number> {
    return await countItems("app_diary_likes", {
        _and: [
            { diary_id: { _eq: diaryId } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

async function getArticleCommentLikeCount(commentId: string): Promise<number> {
    return await countItems("app_article_comment_likes", {
        _and: [
            { article_comment_id: { _eq: commentId } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

async function getDiaryCommentLikeCount(commentId: string): Promise<number> {
    return await countItems("app_diary_comment_likes", {
        _and: [
            { diary_comment_id: { _eq: commentId } },
            { status: { _eq: "published" } },
        ],
    } as JsonObject);
}

async function hasViewerLikedArticle(
    articleId: string,
    viewerId: string,
): Promise<boolean> {
    const rows = await readMany("app_article_likes", {
        filter: {
            _and: [
                { article_id: { _eq: articleId } },
                { user_id: { _eq: viewerId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    return rows.length > 0;
}

async function handleArticleLikeState(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 3 || segments[1] !== "state") {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    const articleId = parseRouteId(segments[2]);
    if (!articleId) {
        return fail("缺少文章 ID", 400);
    }

    const liked = await hasViewerLikedArticle(articleId, access.user.id);
    return ok({
        article_id: articleId,
        liked,
    });
}

async function hasViewerLikedDiary(
    diaryId: string,
    viewerId: string,
): Promise<boolean> {
    const rows = await readMany("app_diary_likes", {
        filter: {
            _and: [
                { diary_id: { _eq: diaryId } },
                { user_id: { _eq: viewerId } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    return rows.length > 0;
}

async function handleDiaryLikeState(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 3 || segments[1] !== "state") {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    const diaryId = parseRouteId(segments[2]);
    if (!diaryId) {
        return fail("缺少日记 ID", 400);
    }

    const liked = await hasViewerLikedDiary(diaryId, access.user.id);
    return ok({
        diary_id: diaryId,
        liked,
    });
}

export async function handleMyArticleLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments[1] === "state") {
        return await handleArticleLikeState(context, access, segments);
    }

    if (segments.length !== 1) {
        return fail("未找到接口", 404);
    }

    if (context.request.method === "GET") {
        const { page, limit, offset } = parsePagination(context.url);
        const rows = await readMany("app_article_likes", {
            filter: {
                _and: [
                    { user_id: { _eq: access.user.id } },
                    { status: { _eq: "published" } },
                ],
            } as JsonObject,
            sort: ["-date_created"],
            limit,
            offset,
            fields: [
                "id",
                "article_id",
                "user_id",
                "status",
                "date_created",
                "date_updated",
            ],
        });
        const total = await countItems("app_article_likes", {
            _and: [
                { user_id: { _eq: access.user.id } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject);
        return ok({
            items: rows,
            page,
            limit,
            total,
        });
    }

    if (context.request.method === "POST") {
        const body = await parseJsonBody(context.request);
        const input = validateBody(ArticleLikeSchema, body);
        const articleId = input.article_id;

        const [article, existing] = await Promise.all([
            readOneById("app_articles", articleId),
            readMany("app_article_likes", {
                filter: {
                    _and: [
                        { article_id: { _eq: articleId } },
                        { user_id: { _eq: access.user.id } },
                    ],
                } as JsonObject,
                sort: ["-date_created"],
                limit: 1,
                fields: ["id", "status"],
            }),
        ]);
        if (
            !article ||
            !(article.status === "published" && article.is_public)
        ) {
            return fail("文章不存在或不可见", 404);
        }
        const current = existing[0];

        let liked: boolean;
        let item: Awaited<ReturnType<typeof createOne<"app_article_likes">>>;
        if (current && current.status === "published") {
            item = await updateOne("app_article_likes", current.id, {
                status: "archived",
            });
            liked = false;
        } else if (current) {
            item = await updateOne("app_article_likes", current.id, {
                status: "published",
            });
            liked = true;
        } else {
            item = await createOne("app_article_likes", {
                status: "published",
                article_id: articleId,
                user_id: access.user.id,
            });
            liked = true;
        }

        const likeCount = await getArticleLikeCount(articleId);
        await awaitCacheInvalidations(
            [
                invalidateArticleInteractionAggregate(articleId),
                invalidateArticleInteractionViewerState(
                    articleId,
                    access.user.id,
                ),
                cacheManager.invalidateByDomain("mixed-feed"),
            ],
            { label: "me/article-likes#toggle" },
        );
        return ok({
            item,
            liked,
            like_count: likeCount,
            article_id: articleId,
        });
    }

    return fail("方法不允许", 405);
}

export async function handleMyDiaryLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments[1] === "state") {
        return await handleDiaryLikeState(context, access, segments);
    }

    if (segments.length !== 1) {
        return fail("未找到接口", 404);
    }

    if (context.request.method === "GET") {
        const { page, limit, offset } = parsePagination(context.url);
        const rows = await readMany("app_diary_likes", {
            filter: {
                _and: [
                    { user_id: { _eq: access.user.id } },
                    { status: { _eq: "published" } },
                ],
            } as JsonObject,
            sort: ["-date_created"],
            limit,
            offset,
            fields: [
                "id",
                "diary_id",
                "user_id",
                "status",
                "date_created",
                "date_updated",
            ],
        });
        const total = await countItems("app_diary_likes", {
            _and: [
                { user_id: { _eq: access.user.id } },
                { status: { _eq: "published" } },
            ],
        } as JsonObject);
        return ok({
            items: rows,
            page,
            limit,
            total,
        });
    }

    if (context.request.method === "POST") {
        const body = await parseJsonBody(context.request);
        const input = validateBody(DiaryLikeSchema, body);
        const diaryId = input.diary_id;

        const [diary, existing] = await Promise.all([
            readOneById("app_diaries", diaryId, {
                fields: [...DIARY_FIELDS],
            }),
            readMany("app_diary_likes", {
                filter: {
                    _and: [
                        { diary_id: { _eq: diaryId } },
                        { user_id: { _eq: access.user.id } },
                    ],
                } as JsonObject,
                sort: ["-date_created"],
                limit: 1,
                fields: ["id", "status"],
            }),
        ]);
        if (
            !diary ||
            !(diary.status === "published" && diary.praviate === true)
        ) {
            return fail("日记不存在或不可见", 404);
        }
        const current = existing[0];

        let liked: boolean;
        let item: Awaited<ReturnType<typeof createOne<"app_diary_likes">>>;
        if (current && current.status === "published") {
            item = await updateOne("app_diary_likes", current.id, {
                status: "archived",
            });
            liked = false;
        } else if (current) {
            item = await updateOne("app_diary_likes", current.id, {
                status: "published",
            });
            liked = true;
        } else {
            item = await createOne("app_diary_likes", {
                status: "published",
                diary_id: diaryId,
                user_id: access.user.id,
            });
            liked = true;
        }

        const likeCount = await getDiaryLikeCount(diaryId);
        await awaitCacheInvalidations(
            [
                invalidateDiaryInteractionAggregate(diaryId),
                invalidateDiaryInteractionViewerState(diaryId, access.user.id),
                cacheManager.invalidateByDomain("mixed-feed"),
            ],
            { label: "me/diary-likes#toggle" },
        );
        return ok({
            item,
            liked,
            like_count: likeCount,
            diary_id: diaryId,
        });
    }

    return fail("方法不允许", 405);
}

export async function handleMyArticleCommentLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 1) {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }

    assertCan(access, "can_comment_articles");
    const body = await parseJsonBody(context.request);
    const input = validateBody(ArticleCommentLikeSchema, body);
    const commentId = input.article_comment_id;

    const [comment, existing] = await Promise.all([
        readOneById("app_article_comments", commentId),
        readMany("app_article_comment_likes", {
            filter: {
                _and: [
                    { article_comment_id: { _eq: commentId } },
                    { user_id: { _eq: access.user.id } },
                ],
            } as JsonObject,
            sort: ["-date_created"],
            limit: 1,
            fields: ["id", "status"],
        }),
    ]);
    if (
        !comment ||
        !(comment.status === "published" && comment.is_public === true)
    ) {
        return fail("评论不存在或不可见", 404);
    }
    const article = await readOneById("app_articles", comment.article_id);
    if (!article || !(article.status === "published" && article.is_public)) {
        return fail("文章不存在或不可见", 404);
    }

    const current = existing[0];

    let liked: boolean;
    let item: Awaited<
        ReturnType<typeof createOne<"app_article_comment_likes">>
    >;
    if (current && current.status === "published") {
        item = await updateOne("app_article_comment_likes", current.id, {
            status: "archived",
        });
        liked = false;
    } else if (current) {
        item = await updateOne("app_article_comment_likes", current.id, {
            status: "published",
        });
        liked = true;
    } else {
        item = await createOne("app_article_comment_likes", {
            status: "published",
            article_comment_id: commentId,
            user_id: access.user.id,
        });
        liked = true;
    }

    const likeCount = await getArticleCommentLikeCount(commentId);
    return ok({
        item,
        liked,
        like_count: likeCount,
        article_comment_id: commentId,
    });
}

export async function handleMyDiaryCommentLikes(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length !== 1) {
        return fail("未找到接口", 404);
    }
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }

    assertCan(access, "can_comment_diaries");
    const body = await parseJsonBody(context.request);
    const input = validateBody(DiaryCommentLikeSchema, body);
    const commentId = input.diary_comment_id;

    const [comment, existing] = await Promise.all([
        readOneById("app_diary_comments", commentId),
        readMany("app_diary_comment_likes", {
            filter: {
                _and: [
                    { diary_comment_id: { _eq: commentId } },
                    { user_id: { _eq: access.user.id } },
                ],
            } as JsonObject,
            sort: ["-date_created"],
            limit: 1,
            fields: ["id", "status"],
        }),
    ]);
    if (
        !comment ||
        !(comment.status === "published" && comment.is_public === true)
    ) {
        return fail("评论不存在或不可见", 404);
    }
    const diary = await readOneById("app_diaries", comment.diary_id, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary || !(diary.status === "published" && diary.praviate === true)) {
        return fail("日记不存在或不可见", 404);
    }

    const current = existing[0];

    let liked: boolean;
    let item: Awaited<ReturnType<typeof createOne<"app_diary_comment_likes">>>;
    if (current && current.status === "published") {
        item = await updateOne("app_diary_comment_likes", current.id, {
            status: "archived",
        });
        liked = false;
    } else if (current) {
        item = await updateOne("app_diary_comment_likes", current.id, {
            status: "published",
        });
        liked = true;
    } else {
        item = await createOne("app_diary_comment_likes", {
            status: "published",
            diary_comment_id: commentId,
            user_id: access.user.id,
        });
        liked = true;
    }

    const likeCount = await getDiaryCommentLikeCount(commentId);
    return ok({
        item,
        liked,
        like_count: likeCount,
        diary_comment_id: commentId,
    });
}
