import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { ARTICLE_TITLE_MAX, weightedCharLength } from "@/constants/text-limits";
import { assertCan } from "@/server/auth/acl";
import { badRequest } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
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
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import {
    createOne,
    deleteOne,
    readMany,
    updateOne,
} from "@/server/directus/client";
import { canTransitionArticleStatus } from "@/server/domain/article/article.rules";
import { createWithShortId } from "@/server/utils/short-id";
import type { AppAccess } from "@/server/api/v1/shared";
import {
    ARTICLE_FIELDS,
    hasOwn,
    parseRouteId,
    safeCsv,
    toSpecialArticleSlug,
} from "@/server/api/v1/shared";
import {
    cleanupOwnedOrphanDirectusFiles,
    collectArticleCommentCleanupCandidates,
    extractDirectusAssetIdsFromMarkdown,
    mergeDirectusFileCleanupCandidates,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";
import {
    bindFileOwnerToUser,
    renderMeMarkdownPreview,
    syncMarkdownFilesToVisibility,
} from "@/server/api/v1/me/_helpers";

type OwnedArticleRecord = JsonObject & {
    id: string;
    author_id: string;
    short_id?: string | null;
};

type ArticleDetailInvalidationTarget = {
    id?: unknown;
    short_id?: unknown;
    slug?: unknown;
};

function addArticleDetailInvalidationKey(
    keys: Set<string>,
    value: unknown,
): void {
    const key = String(value ?? "").trim();
    if (key) {
        keys.add(key);
    }
}

function buildArticleDetailInvalidationTasks(
    ...targets: ArticleDetailInvalidationTarget[]
): Array<Promise<void>> {
    const keys = new Set<string>();
    for (const target of targets) {
        addArticleDetailInvalidationKey(keys, target.id);
        addArticleDetailInvalidationKey(keys, target.short_id);
        addArticleDetailInvalidationKey(keys, target.slug);
    }
    return Array.from(keys, (key) =>
        cacheManager.invalidate("article-detail", key),
    );
}

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

async function handleArticlesPreview(
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

async function handleArticlesList(
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

async function handleArticlesCreate(
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
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            ...buildArticleDetailInvalidationTasks(created),
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "me/articles#create" },
    );
    return ok({ item: { ...created, tags: safeCsv(created?.tags) } });
}

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

    await syncArticleCoverBinding({
        body,
        target,
        nextCoverFile,
        nextVisibility,
        access,
    });
    await cleanupRemovedArticleBodyFiles({
        input,
        target,
        prevBodyFileIds,
        access,
    });
    await syncArticleBodyVisibility({
        input,
        target,
        nextVisibility,
        access,
    });
    await syncExistingArticleCoverVisibility({
        body,
        input,
        target,
        prevCoverFile,
        nextVisibility,
        access,
    });
}

async function syncArticleCoverBinding(params: {
    body: JsonObject;
    target: OwnedArticleRecord;
    nextCoverFile: string | null;
    nextVisibility: "private" | "public";
    access: AppAccess;
}): Promise<void> {
    const prevCoverFile = normalizeDirectusFileId(params.target.cover_file);
    if (hasOwn(params.body, "cover_file") && params.nextCoverFile) {
        const coverTitle = params.target.short_id
            ? `Cover ${params.target.short_id}`
            : undefined;
        await bindFileOwnerToUser(
            params.nextCoverFile,
            params.access.user.id,
            coverTitle,
            params.nextVisibility,
        );
    }
    if (
        hasOwn(params.body, "cover_file") &&
        prevCoverFile &&
        prevCoverFile !== params.nextCoverFile
    ) {
        await cleanupOwnedOrphanDirectusFiles({
            candidateFileIds: [prevCoverFile],
            ownerUserIds: [params.access.user.id],
        });
    }
}

async function cleanupRemovedArticleBodyFiles(params: {
    input: UpdateArticleInput;
    target: OwnedArticleRecord;
    prevBodyFileIds: string[];
    access: AppAccess;
}): Promise<void> {
    if (
        params.input.body_markdown !== undefined &&
        params.prevBodyFileIds.length > 0
    ) {
        const nextBodyFileIds = new Set(
            extractDirectusAssetIdsFromMarkdown(params.input.body_markdown),
        );
        const removedBodyFileIds = params.prevBodyFileIds.filter(
            (id) => !nextBodyFileIds.has(id),
        );
        if (removedBodyFileIds.length > 0) {
            await cleanupOwnedOrphanDirectusFiles({
                candidateFileIds: removedBodyFileIds,
                ownerUserIds: [params.access.user.id],
            });
        }
    }
}

async function syncArticleBodyVisibility(params: {
    input: UpdateArticleInput;
    target: OwnedArticleRecord;
    nextVisibility: "private" | "public";
    access: AppAccess;
}): Promise<void> {
    if (
        params.input.body_markdown !== undefined ||
        params.input.is_public !== undefined ||
        params.input.status !== undefined
    ) {
        await syncMarkdownFilesToVisibility(
            String(
                params.input.body_markdown ?? params.target.body_markdown ?? "",
            ),
            params.access.user.id,
            params.nextVisibility,
        );
    }
}

async function syncExistingArticleCoverVisibility(params: {
    body: JsonObject;
    input: UpdateArticleInput;
    target: OwnedArticleRecord;
    prevCoverFile: string | null;
    nextVisibility: "private" | "public";
    access: AppAccess;
}): Promise<void> {
    if (
        (params.input.is_public !== undefined ||
            params.input.status !== undefined) &&
        params.prevCoverFile &&
        !hasOwn(params.body, "cover_file")
    ) {
        const coverTitle = params.target.short_id
            ? `Cover ${params.target.short_id}`
            : undefined;
        await bindFileOwnerToUser(
            params.prevCoverFile,
            params.access.user.id,
            coverTitle,
            params.nextVisibility,
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

async function handleWorkingDraftGet(access: AppAccess): Promise<Response> {
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

async function handleWorkingDraftPut(
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
                cacheManager.invalidateByDomain("article-taxonomy"),
                cacheManager.invalidateByDomain("article-public"),
                ...buildArticleDetailInvalidationTasks(created),
                cacheManager.invalidateByDomain("mixed-feed"),
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
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            ...buildArticleDetailInvalidationTasks(target, updated),
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "me/articles#working-draft#update" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

async function handleWorkingDraft(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return await handleWorkingDraftGet(access);
    }
    if (context.request.method === "PUT") {
        return await handleWorkingDraftPut(context, access);
    }
    return fail("方法不允许", 405);
}

async function handleArticlePatch(
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
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            ...buildArticleDetailInvalidationTasks(target, updated),
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "me/articles#patch" },
    );
    return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
}

async function handleArticleDelete(
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
            cacheManager.invalidateByDomain("article-taxonomy"),
            cacheManager.invalidateByDomain("article-public"),
            ...buildArticleDetailInvalidationTasks(target),
            cacheManager.invalidateByDomain("mixed-feed"),
        ],
        { label: "me/articles#delete" },
    );
    return ok({ id });
}

async function handleArticleById(
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
        return await handleArticlePatch(context, access, target);
    }
    if (context.request.method === "DELETE") {
        return await handleArticleDelete(target);
    }

    return fail("方法不允许", 405);
}

async function handleArticlesRoot(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return await handleArticlesList(context, access);
    }
    if (context.request.method === "POST") {
        return await handleArticlesCreate(context, access);
    }
    return fail("方法不允许", 405);
}

export async function handleMyArticles(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
        return await handleArticlesPreview(context, access);
    }
    if (segments.length === 2 && segments[1] === "working-draft") {
        return await handleWorkingDraft(context, access);
    }
    if (segments.length === 1) {
        return await handleArticlesRoot(context, access);
    }
    if (segments.length === 2) {
        return await handleArticleById(context, access, segments);
    }
    return fail("未找到接口", 404);
}
