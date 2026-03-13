/* eslint-disable max-lines -- 文章接口需在同一文件内集中处理预览、工作草稿、CRUD 与文件可见性同步。 */
import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan } from "@/server/auth/acl";
import { badRequest } from "@/server/api/errors";
import {
    createOne,
    deleteOne,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    ArticlePreviewSchema,
    CreateArticleSchema,
    UpsertWorkingDraftSchema,
    UpdateArticleSchema,
} from "@/server/api/schemas";
import type {
    UpdateArticleInput,
    UpsertWorkingDraftInput,
} from "@/server/api/schemas";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import { createWithShortId } from "@/server/utils/short-id";
import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";
import { canTransitionArticleStatus } from "@/server/domain/article/article.rules";

import type { AppAccess } from "../shared";
import {
    ARTICLE_FIELDS,
    hasOwn,
    parseRouteId,
    safeCsv,
    toSpecialArticleSlug,
} from "../shared";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectArticleCommentCleanupCandidates,
    extractDirectusAssetIdsFromMarkdown,
    mergeDirectusFileCleanupCandidates,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";
import {
    bindFileOwnerToUser,
    renderMeMarkdownPreview,
    syncMarkdownFilesToVisibility,
} from "./_helpers";

// ── 文章所有权解析（支持 short_id / UUID） ──

type OwnedArticleRecord = JsonObject & {
    id: string;
    author_id: string;
    short_id?: string | null;
};

function normalizeArticleStatus(
    value: unknown,
): "draft" | "published" | "archived" {
    if (value === "published" || value === "archived" || value === "draft") {
        return value;
    }
    return "draft";
}

function resolveArticleAssetVisibility(
    status: unknown,
    isPublic: unknown,
): "private" | "public" {
    return normalizeArticleStatus(status) === "published" && Boolean(isPublic)
        ? "public"
        : "private";
}

function normalizeRequiredArticleText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function assertArticlePublishable(candidate: {
    title: unknown;
    body_markdown: unknown;
}): void {
    const title = normalizeRequiredArticleText(candidate.title);
    const body = normalizeRequiredArticleText(candidate.body_markdown);
    if (!title) {
        throw badRequest("VALIDATION_ERROR", "title: 标题必填");
    }
    if (weightedCharLength(title) > ARTICLE_TITLE_MAX) {
        throw badRequest(
            "VALIDATION_ERROR",
            `title: 标题最多 ${ARTICLE_TITLE_MAX} 字符`,
        );
    }
    if (!body) {
        throw badRequest("VALIDATION_ERROR", "body_markdown: 正文必填");
    }
}

function isUuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

async function resolveOwnedArticle(
    identifier: string,
    ownerId: string,
): Promise<OwnedArticleRecord | null> {
    const normalizedIdentifier = String(identifier ?? "").trim();
    if (!normalizedIdentifier) {
        return null;
    }

    const matchFilters: JsonObject[] = [
        { short_id: { _eq: normalizedIdentifier } as JsonObject },
    ];
    if (isUuidLike(normalizedIdentifier)) {
        matchFilters.push({ id: { _eq: normalizedIdentifier } as JsonObject });
    }

    const rows = await readMany("app_articles", {
        filter: {
            _and: [
                { author_id: { _eq: ownerId } },
                {
                    _or: matchFilters,
                },
            ],
        } as JsonObject,
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        ...first,
        id: String(first.id),
        author_id: String(first.author_id ?? "").trim(),
        short_id:
            first.short_id === null || first.short_id === undefined
                ? null
                : String(first.short_id),
    };
}

async function resolveOwnedWorkingDraft(
    ownerId: string,
): Promise<OwnedArticleRecord | null> {
    const rows = await readMany("app_articles", {
        filter: {
            _and: [
                { author_id: { _eq: ownerId } },
                { status: { _eq: "draft" } },
            ],
        } as JsonObject,
        sort: ["-date_updated", "-date_created"],
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        ...first,
        id: String(first.id),
        author_id: String(first.author_id ?? "").trim(),
        short_id:
            first.short_id === null || first.short_id === undefined
                ? null
                : String(first.short_id),
    };
}

// ── 辅助：Preview ──

async function handleMeArticlesPreview(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    assertCan(access, "can_publish_articles");
    const body = await parseJsonBody(context.request);
    const input = validateBody(ArticlePreviewSchema, body);
    const renderStart = performance.now();
    const bodyHtml = await renderMeMarkdownPreview(
        input.body_markdown,
        input.render_mode,
    );
    const renderDuration = performance.now() - renderStart;
    return ok(
        {
            body_markdown: input.body_markdown,
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

// ── 辅助：列表 ──

async function handleMeArticlesList(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const rows = await readMany("app_articles", {
        filter: {
            author_id: { _eq: access.user.id },
        } as JsonObject,
        sort: ["-date_created"],
        limit,
        offset,
    });
    return ok({
        items: rows.map((row) => ({ ...row, tags: safeCsv(row.tags) })),
        page,
        limit,
        total: rows.length,
    });
}

// ── 辅助：创建 ──

async function handleMeArticlesCreate(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    assertCan(access, "can_publish_articles");
    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateArticleSchema, body);

    const specialSlug = toSpecialArticleSlug(input.slug);
    const articlePayload = {
        status: "published" as const,
        author_id: access.user.id,
        title: input.title,
        slug: specialSlug,
        summary: input.summary ?? null,
        body_markdown: input.body_markdown,
        cover_file: input.cover_file ?? null,
        cover_url: input.cover_url ?? null,
        tags: input.tags,
        category: input.category ?? null,
        allow_comments: input.allow_comments,
        is_public: input.is_public,
    };

    const created = await createWithShortId(
        "app_articles",
        articlePayload,
        (collection, payload) =>
            createOne(collection, payload, {
                fields: [...ARTICLE_FIELDS],
            }),
    );
    if (created?.cover_file) {
        const coverTitle = created.short_id
            ? `Cover ${created.short_id}`
            : undefined;
        await bindFileOwnerToUser(
            created.cover_file,
            access.user.id,
            coverTitle,
            resolveArticleAssetVisibility(created.status, created.is_public),
        );
    }
    await syncMarkdownFilesToVisibility(
        created?.body_markdown,
        access.user.id,
        resolveArticleAssetVisibility(created.status, created.is_public),
    );
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "me/articles#create" },
    );
    return ok({ item: { ...created, tags: safeCsv(created?.tags) } });
}

// ── 辅助：填充文章基本字段到 payload ──

function applyArticleBaseFields(
    payload: JsonObject,
    input: UpdateArticleInput,
    body: JsonObject,
): string | null {
    let nextCoverFile: string | null = null;

    if (input.title !== undefined) {
        payload.title = input.title;
    }
    if (input.slug !== undefined) {
        payload.slug = toSpecialArticleSlug(input.slug);
    }
    if (input.summary !== undefined) {
        payload.summary = input.summary;
    }
    if (input.body_markdown !== undefined) {
        payload.body_markdown = input.body_markdown;
    }
    if (hasOwn(body, "cover_file")) {
        nextCoverFile = normalizeDirectusFileId(input.cover_file);
        payload.cover_file = input.cover_file ?? null;
    }
    if (input.cover_url !== undefined) {
        payload.cover_url = input.cover_url;
    }
    if (input.tags !== undefined) {
        payload.tags = input.tags;
    }
    if (input.category !== undefined) {
        payload.category = input.category;
    }
    if (input.allow_comments !== undefined) {
        payload.allow_comments = input.allow_comments;
    }
    if (input.is_public !== undefined) {
        payload.is_public = input.is_public;
    }
    return nextCoverFile;
}

// ── 辅助：填充状态到 payload ──

function applyArticleStatusFields(
    payload: JsonObject,
    input: UpdateArticleInput,
): "draft" | "published" | "archived" {
    if (input.status !== undefined) {
        payload.status = input.status;
        return normalizeArticleStatus(input.status);
    }
    return "draft";
}

// ── 辅助：构建 PATCH payload ──

function buildArticlePatchPayload(
    input: UpdateArticleInput,
    body: JsonObject,
    target: OwnedArticleRecord,
): {
    payload: JsonObject;
    nextCoverFile: string | null;
    nextStatus: "draft" | "published" | "archived";
    nextIsPublic: boolean;
} {
    const prevCoverFile = normalizeDirectusFileId(target.cover_file);
    const payload: JsonObject = {};

    const newCoverFile = applyArticleBaseFields(payload, input, body);
    const nextCoverFile = newCoverFile ?? prevCoverFile;
    const currentStatus = normalizeArticleStatus(target.status);
    const nextStatus =
        input.status !== undefined
            ? applyArticleStatusFields(payload, input)
            : currentStatus;
    const nextIsPublic =
        input.is_public !== undefined
            ? input.is_public
            : Boolean(target.is_public);

    return { payload, nextCoverFile, nextStatus, nextIsPublic };
}

// ── 辅助：处理 PATCH 后的文件清理 ──

// eslint-disable-next-line complexity -- 文章更新需同时处理封面、正文资源和公开性回收
async function cleanupPatchedArticleFiles(
    body: JsonObject,
    input: UpdateArticleInput,
    target: OwnedArticleRecord,
    nextCoverFile: string | null,
    nextStatus: "draft" | "published" | "archived",
    nextIsPublic: boolean,
    access: AppAccess,
): Promise<void> {
    const prevCoverFile = normalizeDirectusFileId(target.cover_file);
    const prevBodyFileIds =
        input.body_markdown !== undefined
            ? extractDirectusAssetIdsFromMarkdown(
                  String(target.body_markdown ?? ""),
              )
            : [];
    const nextVisibility = resolveArticleAssetVisibility(
        nextStatus,
        nextIsPublic,
    );

    if (hasOwn(body, "cover_file") && nextCoverFile) {
        const coverTitle = target.short_id
            ? `Cover ${target.short_id}`
            : undefined;
        await bindFileOwnerToUser(
            nextCoverFile,
            access.user.id,
            coverTitle,
            nextVisibility,
        );
    }
    if (
        hasOwn(body, "cover_file") &&
        prevCoverFile &&
        prevCoverFile !== nextCoverFile
    ) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevCoverFile],
            ownerUserIds: [access.user.id],
        });
    }
    if (input.body_markdown !== undefined && prevBodyFileIds.length > 0) {
        const nextBodyFileIds = new Set(
            extractDirectusAssetIdsFromMarkdown(input.body_markdown),
        );
        const removedBodyFileIds = prevBodyFileIds.filter(
            (id) => !nextBodyFileIds.has(id),
        );
        if (removedBodyFileIds.length > 0) {
            await cleanupOwnedOrphanDirectusFiles({
                candidateFileIds: removedBodyFileIds,
                ownerUserIds: [access.user.id],
            });
        }
    }
    if (
        input.body_markdown !== undefined ||
        input.is_public !== undefined ||
        input.status !== undefined
    ) {
        await syncMarkdownFilesToVisibility(
            String(input.body_markdown ?? target.body_markdown ?? ""),
            access.user.id,
            nextVisibility,
        );
    }
    if (
        (input.is_public !== undefined || input.status !== undefined) &&
        prevCoverFile &&
        !hasOwn(body, "cover_file")
    ) {
        const coverTitle = target.short_id
            ? `Cover ${target.short_id}`
            : undefined;
        await bindFileOwnerToUser(
            prevCoverFile,
            access.user.id,
            coverTitle,
            nextVisibility,
        );
    }
}

function buildNextArticleSnapshot(
    target: OwnedArticleRecord,
    input: UpdateArticleInput,
    nextStatus: "draft" | "published" | "archived",
): {
    title: string;
    body_markdown: string;
    status: "draft" | "published" | "archived";
} {
    return {
        title:
            input.title !== undefined
                ? String(input.title)
                : String(target.title ?? ""),
        body_markdown:
            input.body_markdown !== undefined
                ? String(input.body_markdown)
                : String(target.body_markdown ?? ""),
        status: nextStatus,
    };
}

function buildWorkingDraftCreatePayload(
    input: UpsertWorkingDraftInput,
    access: AppAccess,
): JsonObject {
    return {
        status: "draft",
        author_id: access.user.id,
        title: input.title ?? "",
        summary: input.summary ?? null,
        body_markdown: input.body_markdown ?? "",
        cover_file: input.cover_file ?? null,
        cover_url: input.cover_url ?? null,
        tags: input.tags ?? [],
        category: input.category ?? null,
        allow_comments: input.allow_comments ?? true,
        is_public: input.is_public ?? true,
    };
}

function buildWorkingDraftUpdatePayload(
    input: UpsertWorkingDraftInput,
    body: JsonObject,
    target: OwnedArticleRecord,
): { payload: JsonObject; nextCoverFile: string | null } {
    const payload: JsonObject = {};
    const prevCoverFile = normalizeDirectusFileId(target.cover_file);
    const newCoverFile = applyArticleBaseFields(
        payload,
        input as UpdateArticleInput,
        body,
    );
    const nextCoverFile = newCoverFile ?? prevCoverFile;
    payload.status = "draft";
    return { payload, nextCoverFile };
}

async function handleMeArticlesWorkingDraftGet(
    access: AppAccess,
): Promise<Response> {
    const draft = await resolveOwnedWorkingDraft(access.user.id);
    if (!draft) {
        return ok({ item: null });
    }
    return ok({
        item: {
            ...draft,
            tags: safeCsv(draft.tags as string[] | null | undefined),
        },
    });
}

async function handleMeArticlesWorkingDraftPut(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    assertCan(access, "can_publish_articles");
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpsertWorkingDraftSchema, body);
    const target = await resolveOwnedWorkingDraft(access.user.id);

    if (!target) {
        const created = await createWithShortId(
            "app_articles",
            buildWorkingDraftCreatePayload(input, access),
            (collection, payload) =>
                createOne(collection, payload, {
                    fields: [...ARTICLE_FIELDS],
                }),
        );
        const visibility = resolveArticleAssetVisibility(
            created.status,
            created.is_public,
        );
        if (created.cover_file) {
            const coverTitle = created.short_id
                ? `Cover ${created.short_id}`
                : undefined;
            await bindFileOwnerToUser(
                created.cover_file,
                access.user.id,
                coverTitle,
                visibility,
            );
        }
        await syncMarkdownFilesToVisibility(
            created.body_markdown,
            access.user.id,
            visibility,
        );
        await awaitCacheInvalidations(
            [
                cacheManager.invalidateByDomain("article-list"),
                cacheManager.invalidateByDomain("article-public"),
                cacheManager.invalidateByDomain("home-feed"),
            ],
            { label: "me/articles#working-draft#create" },
        );
        return ok({ item: { ...created, tags: safeCsv(created.tags) } });
    }

    const { payload, nextCoverFile } = buildWorkingDraftUpdatePayload(
        input,
        body as JsonObject,
        target,
    );
    const updated = await updateOne("app_articles", target.id, payload, {
        fields: [...ARTICLE_FIELDS],
    });
    await cleanupPatchedArticleFiles(
        body as JsonObject,
        {
            ...(input as UpdateArticleInput),
            status: "draft",
        },
        target,
        nextCoverFile,
        "draft",
        input.is_public ?? Boolean(target.is_public),
        access,
    );
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", target.id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "me/articles#working-draft#update" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

async function handleMeArticlesWorkingDraft(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleMeArticlesWorkingDraftGet(access);
    }
    if (context.request.method === "PUT") {
        return handleMeArticlesWorkingDraftPut(context, access);
    }
    return fail("方法不允许", 405);
}

// ── 辅助：更新（PATCH） ──

async function handleMeArticlesPatch(
    context: APIContext,
    access: AppAccess,
    target: OwnedArticleRecord,
): Promise<Response> {
    const id = target.id;
    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateArticleSchema, body);
    const currentStatus = normalizeArticleStatus(target.status);
    const { payload, nextCoverFile, nextStatus, nextIsPublic } =
        buildArticlePatchPayload(input, body as JsonObject, target);
    if (nextStatus !== currentStatus) {
        if (!canTransitionArticleStatus(currentStatus, nextStatus)) {
            throw badRequest(
                "INVALID_STATUS_TRANSITION",
                `不允许从 ${currentStatus} 转换到 ${nextStatus}`,
            );
        }
    }

    const nextSnapshot = buildNextArticleSnapshot(target, input, nextStatus);
    if (nextSnapshot.status === "published") {
        assertArticlePublishable(nextSnapshot);
    }

    const updated = await updateOne("app_articles", id, payload, {
        fields: [...ARTICLE_FIELDS],
    });
    await cleanupPatchedArticleFiles(
        body as JsonObject,
        input,
        target,
        nextCoverFile,
        nextStatus,
        nextIsPublic,
        access,
    );

    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "me/articles#patch" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

// ── 辅助：删除 ──

async function handleMeArticlesDelete(
    target: OwnedArticleRecord,
): Promise<Response> {
    const id = target.id;
    const coverFile = normalizeDirectusFileId(target.cover_file);
    const bodyFileIds = extractDirectusAssetIdsFromMarkdown(
        String(target.body_markdown ?? ""),
    );
    const relatedCommentCandidates =
        await collectArticleCommentCleanupCandidates(id);
    await deleteOne("app_articles", id);
    const cleanupCandidates = mergeDirectusFileCleanupCandidates(
        {
            candidateFileIds: [
                ...(coverFile ? [coverFile] : []),
                ...bodyFileIds,
            ],
            ownerUserIds: [target.author_id],
        },
        relatedCommentCandidates,
    );
    if (cleanupCandidates.candidateFileIds.length > 0) {
        await cleanupOwnedOrphanDirectusFiles(cleanupCandidates);
    }
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", id),
            cacheManager.invalidateByDomain("home-feed"),
        ],
        { label: "me/articles#delete" },
    );
    return ok({ id });
}

// ── 辅助：单篇文章路由分发（segments.length === 2，非 preview） ──

async function handleMeArticleById(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    const identifier = parseRouteId(segments[1]);
    if (!identifier) {
        return fail("缺少文章 ID", 400);
    }
    const target = await resolveOwnedArticle(identifier, access.user.id);
    if (!target) {
        return fail("文章不存在", 404);
    }

    if (context.request.method === "GET") {
        return ok({
            item: {
                ...target,
                tags: safeCsv(target.tags as string[] | null | undefined),
            },
        });
    }
    if (context.request.method === "PATCH") {
        return handleMeArticlesPatch(context, access, target);
    }
    if (context.request.method === "DELETE") {
        return handleMeArticlesDelete(target);
    }

    return fail("方法不允许", 405);
}

// ── 辅助：列表路由分发（segments.length === 1） ──

async function handleMeArticlesRoot(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleMeArticlesList(context, access);
    }
    if (context.request.method === "POST") {
        return handleMeArticlesCreate(context, access);
    }
    return fail("方法不允许", 405);
}

// ── 主入口 ──

export async function handleMeArticles(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
        return handleMeArticlesPreview(context, access);
    }
    if (segments.length === 2 && segments[1] === "working-draft") {
        return handleMeArticlesWorkingDraft(context, access);
    }
    if (segments.length === 1) {
        return handleMeArticlesRoot(context, access);
    }
    if (segments.length === 2) {
        return handleMeArticleById(context, access, segments);
    }
    return fail("未找到接口", 404);
}
