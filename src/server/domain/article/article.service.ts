/**
 * Article Service — 业务编排层
 *
 * 协调 Rules（纯函数）、Repository（数据访问）和副作用（缓存、文件清理）。
 * API Handler 调用 Service 完成业务逻辑，自身只负责请求解析和响应格式化。
 */

import type { AppArticle } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { forbidden, badRequest } from "@/server/api/errors";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectArticleCommentCleanupCandidates,
    mergeDirectusFileCleanupCandidates,
    extractDirectusAssetIdsFromMarkdown,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";

import {
    canUserModifyArticle,
    isArticlePubliclyVisible,
    isArticleCommentable,
    canTransitionArticleStatus,
} from "./article.rules";
import * as articleRepo from "./article.repository";
import type { CreateArticleInput, UpdateArticleInput } from "./article.types";

// ── 创建 ──

export async function createArticle(
    input: CreateArticleInput,
    authorId: string,
): Promise<AppArticle> {
    const status = input.status ?? "draft";

    return await articleRepo.create({
        author_id: authorId,
        status,
        title: input.title,
        slug: input.slug ?? null,
        summary: input.summary ?? null,
        body_markdown: input.body_markdown,
        cover_file: input.cover_file ?? null,
        cover_url: input.cover_url ?? null,
        tags: input.tags ?? null,
        category: input.category ?? null,
        allow_comments: input.allow_comments ?? true,
        is_public: input.is_public ?? true,
    } as Partial<AppArticle>);
}

// ── 更新 ──

function buildArticleUpdatePayload(input: UpdateArticleInput): JsonObject {
    const payload: JsonObject = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.slug !== undefined) payload.slug = input.slug;
    if (input.summary !== undefined) payload.summary = input.summary;
    if (input.body_markdown !== undefined)
        payload.body_markdown = input.body_markdown;
    if (input.cover_url !== undefined) payload.cover_url = input.cover_url;
    if (input.tags !== undefined) payload.tags = input.tags;
    if (input.category !== undefined) payload.category = input.category;
    if (input.allow_comments !== undefined)
        payload.allow_comments = input.allow_comments;
    if (input.is_public !== undefined) payload.is_public = input.is_public;
    if (input.status !== undefined) payload.status = input.status;
    return payload;
}

function applyArticleCoverFileToPayload(
    payload: JsonObject,
    input: UpdateArticleInput,
    rawBody: JsonObject,
    prevCoverFile: string | null,
): { payload: JsonObject; nextCoverFile: string | null } {
    if (!Object.hasOwn(rawBody, "cover_file")) {
        return { payload, nextCoverFile: prevCoverFile };
    }
    const nextCoverFile = normalizeDirectusFileId(input.cover_file);
    return {
        payload: { ...payload, cover_file: input.cover_file ?? null },
        nextCoverFile,
    };
}

async function cleanupOldCoverIfNeeded(
    rawBody: JsonObject | undefined,
    prevCoverFile: string | null,
    nextCoverFile: string | null,
    articleAuthorId: string,
): Promise<void> {
    if (
        rawBody &&
        Object.hasOwn(rawBody, "cover_file") &&
        prevCoverFile &&
        prevCoverFile !== nextCoverFile
    ) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevCoverFile],
            ownerUserIds: [articleAuthorId],
        });
    }
}

export async function updateArticle(
    articleId: string,
    input: UpdateArticleInput,
    userId: string,
    isAdmin: boolean,
    /** 原始 body 对象，用于检测文件字段是否被显式传入 */
    rawBody?: JsonObject,
): Promise<AppArticle> {
    const article = await articleRepo.findById(articleId);
    if (!article) {
        throw badRequest("ARTICLE_NOT_FOUND", "文章不存在");
    }
    if (!canUserModifyArticle(userId, article.author_id, isAdmin)) {
        throw forbidden();
    }

    // 状态转换校验
    if (input.status !== undefined && input.status !== article.status) {
        if (!canTransitionArticleStatus(article.status, input.status)) {
            throw badRequest(
                "INVALID_STATUS_TRANSITION",
                `不允许从 ${article.status} 转换到 ${input.status}`,
            );
        }
    }

    const prevCoverFile = normalizeDirectusFileId(article.cover_file);
    let payload = buildArticleUpdatePayload(input);

    const coverResult = rawBody
        ? applyArticleCoverFileToPayload(payload, input, rawBody, prevCoverFile)
        : { payload, nextCoverFile: prevCoverFile };
    payload = coverResult.payload;
    const nextCoverFile = coverResult.nextCoverFile;

    const updated = await articleRepo.update(articleId, payload);

    await cleanupOldCoverIfNeeded(
        rawBody,
        prevCoverFile,
        nextCoverFile,
        article.author_id,
    );

    return updated;
}

// ── 删除 ──

export async function deleteArticle(
    articleId: string,
    userId: string,
    isAdmin: boolean,
): Promise<void> {
    const article = await articleRepo.findById(articleId);
    if (!article) {
        throw badRequest("ARTICLE_NOT_FOUND", "文章不存在");
    }
    if (!canUserModifyArticle(userId, article.author_id, isAdmin)) {
        throw forbidden();
    }

    const coverFileId = normalizeDirectusFileId(article.cover_file);
    const bodyFileIds = extractDirectusAssetIdsFromMarkdown(
        String(article.body_markdown ?? ""),
    );
    const relatedCommentCandidates =
        await collectArticleCommentCleanupCandidates(articleId);
    await articleRepo.remove(articleId);
    const cleanupCandidates = mergeDirectusFileCleanupCandidates(
        {
            candidateFileIds: [
                ...(coverFileId ? [coverFileId] : []),
                ...bodyFileIds,
            ],
            ownerUserIds: [article.author_id],
        },
        relatedCommentCandidates,
    );
    if (cleanupCandidates.candidateFileIds.length > 0) {
        await cleanupOwnedOrphanDirectusFiles(cleanupCandidates);
    }
}

// ── 查询 ──

export async function getPublicArticle(id: string): Promise<AppArticle | null> {
    return await articleRepo.findPublicById(id);
}

export async function getPublicArticleBySlug(
    slug: string,
): Promise<AppArticle | null> {
    return await articleRepo.findPublicBySlug(slug);
}

export async function getPublicArticleByShortId(
    shortId: string,
): Promise<AppArticle | null> {
    return await articleRepo.findPublicByShortId(shortId);
}

/** 检查文章是否可见（用于评论等场景） */
export function checkArticleVisible(
    article: Pick<AppArticle, "status" | "is_public">,
): boolean {
    return isArticlePubliclyVisible(article);
}

/** 检查文章是否允许评论 */
export function checkArticleCommentable(
    article: Pick<AppArticle, "allow_comments" | "status" | "is_public">,
): boolean {
    return isArticleCommentable(article);
}
