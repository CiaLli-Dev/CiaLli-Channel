/* eslint-disable max-lines -- 管理设置入口暂集中处理 site/bulletin/about 三类配置 */
import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type {
    EditableSiteSettings,
    SiteSettingsPayload,
} from "@/types/site-settings";
import type { JsonObject } from "@/types/json";
import { canonicalizeSiteTimeZone } from "@/utils/date-utils";
import {
    createOne,
    readMany,
    runWithDirectusUserAccess,
    updateDirectusFileMetadata,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { awaitCacheInvalidations } from "@/server/cache/invalidation";
import { cacheManager } from "@/server/cache/manager";
import {
    AdminAboutPreviewSchema,
    AdminAboutUpdateSchema,
    AdminBulletinPreviewSchema,
    AdminBulletinUpdateSchema,
} from "@/server/api/schemas";
import {
    renderMarkdown,
    type MarkdownRenderMode,
} from "@/server/markdown/render";
import {
    getResolvedSiteSettings,
    invalidateSiteSettingsCache,
    resolveSiteSettingsPayload,
} from "@/server/site-settings/service";
import { cleanupOwnedOrphanDirectusFiles } from "../shared/file-cleanup";

import { requireAdmin } from "../shared";

const ABOUT_ARTICLE_SLUG = "about";
const ABOUT_FALLBACK_TITLE = "关于我们";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSiteTimeZonePatch(body: unknown): string | null {
    if (!isObjectRecord(body) || !isObjectRecord(body.site)) {
        return null;
    }
    if (!Object.prototype.hasOwnProperty.call(body.site, "timeZone")) {
        return null;
    }
    const rawTimeZone = body.site.timeZone;
    if (
        rawTimeZone === null ||
        rawTimeZone === undefined ||
        String(rawTimeZone).trim() === ""
    ) {
        return null;
    }
    if (typeof rawTimeZone !== "string") {
        throw new Error("站点时区无效");
    }
    const normalized = canonicalizeSiteTimeZone(rawTimeZone);
    if (!normalized) {
        throw new Error("站点时区无效");
    }
    return normalized;
}

async function readSiteSettingsRowMeta(): Promise<{
    id: string;
    updatedAt: string | null;
} | null> {
    const rows = await readMany("app_site_settings", {
        filter: { key: { _eq: "default" } } as JsonObject,
        limit: 1,
        sort: ["-date_updated", "-date_created"],
        fields: ["id", "date_updated", "date_created"],
    });
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        updatedAt: row.date_updated || row.date_created || null,
    };
}

async function upsertSiteSettings(
    settings: SiteSettingsPayload,
): Promise<{ updatedAt: string | null }> {
    const existing = await readSiteSettingsRowMeta();
    if (!existing) {
        const created = await createOne("app_site_settings", {
            key: "default",
            status: "published",
            settings,
        });
        return {
            updatedAt: created.date_updated || created.date_created || null,
        };
    }

    const updated = await updateOne("app_site_settings", existing.id, {
        key: "default",
        status: "published",
        settings,
    });
    return {
        updatedAt: updated.date_updated || updated.date_created || null,
    };
}

const DIRECTUS_FILE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractDirectusFileIdFromAssetValue(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const raw = value.trim();
    if (!raw) {
        return null;
    }
    if (DIRECTUS_FILE_ID_PATTERN.test(raw)) {
        return raw;
    }
    try {
        const parsed = new URL(raw, "http://localhost");
        const path = parsed.pathname;
        const directPattern = /^\/api\/v1\/public\/assets\/([^/?#]+)\/?$/;
        const assetPattern = /^\/assets\/([^/?#]+)\/?$/;
        const matched =
            path.match(directPattern)?.[1] ||
            path.match(assetPattern)?.[1] ||
            "";
        if (!matched) {
            return null;
        }
        const decoded = decodeURIComponent(matched).trim();
        return DIRECTUS_FILE_ID_PATTERN.test(decoded) ? decoded : null;
    } catch {
        return null;
    }
}

function collectBannerAssetValues(value: unknown): string[] {
    if (typeof value === "string") {
        return [value];
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === "string" ? entry : ""))
            .filter(Boolean);
    }
    return [];
}

function collectSettingsFileIds(settings: SiteSettingsPayload): Set<string> {
    const ids = new Set<string>();
    const collectSingleAsset = (value: unknown): void => {
        const fileId = extractDirectusFileIdFromAssetValue(value);
        if (fileId) {
            ids.add(fileId);
        }
    };

    for (const item of settings.site.favicon || []) {
        collectSingleAsset(item.src);
    }
    for (const source of collectBannerAssetValues(settings.banner.src)) {
        collectSingleAsset(source);
    }
    collectSingleAsset(settings.navbarTitle.icon);
    collectSingleAsset(settings.navbarTitle.logo);
    collectSingleAsset(settings.profile.avatar);
    return ids;
}

async function renderSettingsMarkdown(
    markdown: string,
    scene: "bulletin" | "about",
    mode: MarkdownRenderMode = "full",
): Promise<string> {
    const source = String(markdown || "");
    if (!source.trim()) {
        return "";
    }
    try {
        return await renderMarkdown(source, { target: "page", mode });
    } catch (error) {
        console.error(
            `[admin-settings] ${scene} markdown render failed:`,
            error,
        );
        return "";
    }
}

type AboutArticleData = {
    id: string;
    title: string;
    summary: string;
    body_markdown: string;
    updated_at: string | null;
};

async function readAboutArticleRow(): Promise<AboutArticleData | null> {
    const rows = await readMany("app_articles", {
        filter: { slug: { _eq: ABOUT_ARTICLE_SLUG } } as JsonObject,
        limit: 1,
        sort: ["-date_updated", "-date_created"],
        fields: [
            "id",
            "title",
            "summary",
            "body_markdown",
            "date_updated",
            "date_created",
        ],
    });
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        id: String(row.id),
        title: String(row.title || "").trim() || ABOUT_FALLBACK_TITLE,
        summary: String(row.summary || "").trim(),
        body_markdown: String(row.body_markdown || ""),
        updated_at: row.date_updated || row.date_created || null,
    };
}

// ── 辅助：从 Directus 记录映射 AboutArticleData ──

function mapRowToAboutArticleData(row: JsonObject): AboutArticleData {
    return {
        id: String(row.id),
        title: String(row.title || "").trim() || ABOUT_FALLBACK_TITLE,
        summary: String(row.summary || "").trim(),
        body_markdown: String(row.body_markdown || ""),
        updated_at:
            (row.date_updated as string | null) ||
            (row.date_created as string | null) ||
            null,
    };
}

// ── 辅助：构建 about 文章字段 ──

function buildAboutArticleFields(
    input: {
        title?: string | null;
        summary?: string | null;
        body_markdown: string;
    },
    existing: AboutArticleData | null,
): { title: string; summary: string | null } {
    const title =
        String(input.title || "").trim() ||
        existing?.title ||
        ABOUT_FALLBACK_TITLE;
    const summaryStr =
        input.summary !== undefined
            ? String(input.summary || "").trim()
            : existing?.summary || "";
    return { title, summary: summaryStr || null };
}

async function upsertAboutArticle(
    adminUserId: string,
    input: {
        title?: string | null;
        summary?: string | null;
        body_markdown: string;
    },
): Promise<AboutArticleData> {
    const existing = await readAboutArticleRow();
    const { title, summary } = buildAboutArticleFields(input, existing);
    const payload = {
        status: "published" as const,
        title,
        slug: ABOUT_ARTICLE_SLUG,
        summary,
        body_markdown: input.body_markdown,
        allow_comments: false,
        is_public: true,
    };

    if (!existing) {
        const created = await createOne("app_articles", {
            ...payload,
            author_id: adminUserId,
            cover_file: null,
            cover_url: null,
            tags: [] as string[],
            category: null,
        });
        return mapRowToAboutArticleData(created);
    }

    const updated = await updateOne("app_articles", existing.id, payload);
    return mapRowToAboutArticleData(updated);
}

// ── 辅助：渲染预览响应 ──

function buildMarkdownPreviewResponse(
    bodyMarkdown: string,
    bodyHtml: string,
    renderDuration: number,
    renderMode: string,
): Response {
    return ok(
        {
            body_markdown: bodyMarkdown,
            body_html: bodyHtml,
        },
        {
            headers:
                process.env.NODE_ENV === "production"
                    ? undefined
                    : {
                          "Server-Timing": `md-render;dur=${renderDuration.toFixed(2)};desc="${renderMode}"`,
                      },
        },
    );
}

// ── 路由处理：/admin/settings/site ──

async function handleAdminSiteGet(): Promise<Response> {
    const [resolved, rowMeta] = await Promise.all([
        getResolvedSiteSettings(),
        readSiteSettingsRowMeta(),
    ]);
    return ok({
        settings: resolved.settings,
        updated_at: rowMeta?.updatedAt || null,
    });
}

async function handleAdminSitePatch(
    context: APIContext,
    adminUserId: string,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    try {
        const normalizedTimeZone = validateSiteTimeZonePatch(body);
        if (
            normalizedTimeZone &&
            isObjectRecord(body) &&
            isObjectRecord(body.site)
        ) {
            body.site.timeZone = normalizedTimeZone;
        }
    } catch (error) {
        return fail(
            error instanceof Error ? error.message : "站点时区无效",
            400,
            "INVALID_TIME_ZONE",
        );
    }
    const patch = body as Partial<EditableSiteSettings>;
    const current = await getResolvedSiteSettings();
    const settings = resolveSiteSettingsPayload(patch, current.settings);
    const prevFileIds = collectSettingsFileIds(current.settings);
    const nextFileIds = collectSettingsFileIds(settings);
    const removedFileIds = [...prevFileIds].filter(
        (fileId) => !nextFileIds.has(fileId),
    );
    const { updatedAt } = await upsertSiteSettings(settings);
    for (const fileId of nextFileIds) {
        await updateDirectusFileMetadata(fileId, {
            uploaded_by: adminUserId,
            app_owner_user_id: adminUserId,
            app_visibility: "public",
        });
    }
    invalidateSiteSettingsCache();
    await cleanupOwnedOrphanDirectusFiles({
        candidateFileIds: removedFileIds,
    });
    return ok({
        settings,
        updated_at: updatedAt,
    });
}

async function handleAdminSite(
    context: APIContext,
    adminUserId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleAdminSiteGet();
    }
    if (context.request.method === "PATCH") {
        return handleAdminSitePatch(context, adminUserId);
    }
    return fail("方法不允许", 405);
}

// ── 路由处理：/admin/settings/bulletin/preview ──

async function handleAdminBulletinPreview(
    context: APIContext,
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminBulletinPreviewSchema, body);
    const renderStart = performance.now();
    const bodyHtml = await renderSettingsMarkdown(
        input.body_markdown,
        "bulletin",
        input.render_mode,
    );
    const renderDuration = performance.now() - renderStart;
    return buildMarkdownPreviewResponse(
        input.body_markdown,
        bodyHtml,
        renderDuration,
        input.render_mode,
    );
}

// ── 路由处理：/admin/settings/bulletin ──

async function handleAdminBulletinGet(): Promise<Response> {
    const [resolved, rowMeta] = await Promise.all([
        getResolvedSiteSettings(),
        readSiteSettingsRowMeta(),
    ]);
    return ok({
        announcement: resolved.settings.announcement,
        updated_at: rowMeta?.updatedAt || null,
    });
}

async function handleAdminBulletinPatch(
    context: APIContext,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminBulletinUpdateSchema, body);
    const current = await getResolvedSiteSettings();
    const announcementPatch: EditableSiteSettings["announcement"] = {
        ...current.settings.announcement,
        ...(input.title !== undefined
            ? { title: String(input.title ?? "") }
            : {}),
        ...(input.summary !== undefined
            ? { summary: String(input.summary ?? "") }
            : {}),
        ...(input.body_markdown !== undefined
            ? { body_markdown: input.body_markdown }
            : {}),
        ...(input.closable !== undefined ? { closable: input.closable } : {}),
    };
    const settings = resolveSiteSettingsPayload(
        { announcement: announcementPatch },
        current.settings,
    );
    const { updatedAt } = await upsertSiteSettings(settings);
    invalidateSiteSettingsCache();
    return ok({
        announcement: settings.announcement,
        updated_at: updatedAt,
    });
}

async function handleAdminBulletin(context: APIContext): Promise<Response> {
    if (context.request.method === "GET") {
        return handleAdminBulletinGet();
    }
    if (context.request.method === "PATCH") {
        return handleAdminBulletinPatch(context);
    }
    return fail("方法不允许", 405);
}

// ── 路由处理：/admin/settings/about/preview ──

async function handleAdminAboutPreview(context: APIContext): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminAboutPreviewSchema, body);
    const renderStart = performance.now();
    const bodyHtml = await renderSettingsMarkdown(
        input.body_markdown,
        "about",
        input.render_mode,
    );
    const renderDuration = performance.now() - renderStart;
    return buildMarkdownPreviewResponse(
        input.body_markdown,
        bodyHtml,
        renderDuration,
        input.render_mode,
    );
}

// ── 路由处理：/admin/settings/about ──

async function handleAdminAboutGet(): Promise<Response> {
    const about = await readAboutArticleRow();
    return ok({
        about: about || {
            id: null,
            title: ABOUT_FALLBACK_TITLE,
            summary: "",
            body_markdown: "",
            updated_at: null,
        },
        updated_at: about?.updated_at || null,
    });
}

async function handleAdminAboutPatch(
    context: APIContext,
    adminUserId: string,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminAboutUpdateSchema, body);
    const about = await upsertAboutArticle(adminUserId, {
        title: input.title,
        summary: input.summary,
        body_markdown: input.body_markdown,
    });
    await awaitCacheInvalidations(
        [
            cacheManager.invalidateByDomain("article-list"),
            cacheManager.invalidateByDomain("article-public"),
            cacheManager.invalidate("article-detail", ABOUT_ARTICLE_SLUG),
            cacheManager.invalidate("article-detail", about.id),
        ],
        { label: "admin/settings#about" },
    );
    return ok({
        about,
        updated_at: about.updated_at,
    });
}

async function handleAdminAbout(
    context: APIContext,
    adminUserId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleAdminAboutGet();
    }
    if (context.request.method === "PATCH") {
        return handleAdminAboutPatch(context, adminUserId);
    }
    return fail("方法不允许", 405);
}

// ── 主入口 ──

export async function handleAdminSettings(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    return await runWithDirectusUserAccess(required.accessToken, async () => {
        if (segments.length < 2) {
            return fail("未找到接口", 404);
        }

        if (segments[1] === "site" && segments.length === 2) {
            return handleAdminSite(context, required.access.user.id);
        }

        if (
            segments[1] === "bulletin" &&
            segments.length === 3 &&
            segments[2] === "preview"
        ) {
            return handleAdminBulletinPreview(context);
        }

        if (segments[1] === "bulletin" && segments.length === 2) {
            return handleAdminBulletin(context);
        }

        if (
            segments[1] === "about" &&
            segments.length === 3 &&
            segments[2] === "preview"
        ) {
            return handleAdminAboutPreview(context);
        }

        if (segments[1] === "about" && segments.length === 2) {
            return handleAdminAbout(context, required.access.user.id);
        }

        return fail("未找到接口", 404);
    });
}
