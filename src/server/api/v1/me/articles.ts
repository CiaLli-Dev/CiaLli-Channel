import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan } from "@/server/auth/acl";
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
    UpdateArticleSchema,
} from "@/server/api/schemas";
import { cacheManager } from "@/server/cache/manager";
import { createWithShortId } from "@/server/utils/short-id";

import type { AppAccess } from "../shared";
import {
    hasOwn,
    nowIso,
    parseRouteId,
    safeCsv,
    toSpecialArticleSlug,
} from "../shared";
import {
    cleanupOrphanDirectusFiles,
    extractDirectusFileIdsFromUnknown,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";
import { bindFileOwnerToUser, renderMeMarkdownPreview } from "./_helpers";

// ── 文章所有权解析（支持 short_id / UUID） ──

type OwnedArticleRecord = JsonObject & {
    id: string;
    author_id: string;
    short_id?: string | null;
};

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

export async function handleMeArticles(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
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

    if (segments.length === 1) {
        if (context.request.method === "GET") {
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

        if (context.request.method === "POST") {
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
                published_at: input.published_at || nowIso(),
            };

            const created = await createWithShortId(
                "app_articles",
                articlePayload,
                createOne,
            );
            if (created?.cover_file) {
                const coverTitle = created.short_id
                    ? `Cover ${created.short_id}`
                    : undefined;
                await bindFileOwnerToUser(
                    created.cover_file,
                    access.user.id,
                    coverTitle,
                );
            }
            void cacheManager.invalidateByDomain("article-list");
            void cacheManager.invalidateByDomain("article-public");
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ item: { ...created, tags: safeCsv(created?.tags) } });
        }
    }

    if (segments.length === 2) {
        const identifier = parseRouteId(segments[1]);
        if (!identifier) {
            return fail("缺少文章 ID", 400);
        }
        const target = await resolveOwnedArticle(identifier, access.user.id);
        if (!target) {
            return fail("文章不存在", 404);
        }
        const id = target.id;

        if (context.request.method === "GET") {
            return ok({
                item: {
                    ...target,
                    tags: safeCsv(target.tags as string[] | null | undefined),
                },
            });
        }

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateArticleSchema, body);
            const payload: JsonObject = {};
            const prevCoverFile = normalizeDirectusFileId(target.cover_file);
            let nextCoverFile = prevCoverFile;
            const prevBodyFileIds =
                input.body_markdown !== undefined
                    ? extractDirectusFileIdsFromUnknown(target.body_markdown)
                    : [];

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
            if (hasOwn(body as JsonObject, "cover_file")) {
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
            if (input.status !== undefined) {
                payload.status = "published";
            }
            if (input.is_public !== undefined) {
                payload.is_public = input.is_public;
            }
            if (input.published_at !== undefined) {
                payload.published_at = input.published_at;
            }
            if (String(target.status ?? "").trim() !== "published") {
                payload.status = "published";
            }
            if (
                String(payload.status ?? "").trim() === "published" &&
                payload.published_at === undefined
            ) {
                const targetPublishedAt = String(
                    target.published_at ?? "",
                ).trim();
                payload.published_at = targetPublishedAt || nowIso();
            }

            const updated = await updateOne("app_articles", id, payload);
            if (hasOwn(body as JsonObject, "cover_file") && nextCoverFile) {
                const coverTitle = target.short_id
                    ? `Cover ${target.short_id}`
                    : undefined;
                await bindFileOwnerToUser(
                    nextCoverFile,
                    access.user.id,
                    coverTitle,
                );
            }
            if (
                hasOwn(body as JsonObject, "cover_file") &&
                prevCoverFile &&
                prevCoverFile !== nextCoverFile
            ) {
                await cleanupOrphanDirectusFiles([prevCoverFile]);
            }
            if (
                input.body_markdown !== undefined &&
                prevBodyFileIds.length > 0
            ) {
                const nextBodyFileIds = new Set(
                    extractDirectusFileIdsFromUnknown(input.body_markdown),
                );
                const removedBodyFileIds = prevBodyFileIds.filter(
                    (id) => !nextBodyFileIds.has(id),
                );
                if (removedBodyFileIds.length > 0) {
                    await cleanupOrphanDirectusFiles(removedBodyFileIds);
                }
            }
            void cacheManager.invalidateByDomain("article-list");
            void cacheManager.invalidateByDomain("article-public");
            void cacheManager.invalidate("article-detail", id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ item: { ...updated, tags: safeCsv(updated.tags) } });
        }

        if (context.request.method === "DELETE") {
            const coverFile = normalizeDirectusFileId(target.cover_file);
            const bodyFileIds = extractDirectusFileIdsFromUnknown(
                target.body_markdown,
            );
            await deleteOne("app_articles", id);
            const allFileIds = [
                ...(coverFile ? [coverFile] : []),
                ...bodyFileIds,
            ];
            if (allFileIds.length > 0) {
                await cleanupOrphanDirectusFiles(allFileIds);
            }
            void cacheManager.invalidateByDomain("article-list");
            void cacheManager.invalidateByDomain("article-public");
            void cacheManager.invalidate("article-detail", id);
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ id });
        }
    }

    return fail("未找到接口", 404);
}
