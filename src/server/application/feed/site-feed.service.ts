import type { JsonObject } from "@/types/json";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
} from "@/server/api/v1/shared";
import {
    readMany,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import { renderMarkdown } from "@/server/markdown/render";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import type { ResolvedSiteSettings } from "@/types/site-settings";
import {
    buildPostUrl,
    isProtectedContentBody,
} from "@/utils/content-post-helpers";

type FeedSourceRow = {
    id: string;
    short_id: string | null;
    author_id: string;
    title: string;
    summary: string | null;
    body_markdown: string;
    category: string | null;
    date_created: string | null;
    date_updated: string | null;
};

type FeedSourceEntry = {
    id: string;
    title: string;
    summary: string;
    body: string;
    link: string;
    published: Date;
    updated: Date;
    authorName: string;
    category: string | null;
};

export type SiteFeedPreviewEntry = {
    id: string;
    title: string;
    summary: string;
    url: string;
    published: Date;
};

export type SiteFeedEntry = {
    title: string;
    summary: string;
    link: string;
    content: string;
    published: Date;
    updated: Date;
    authorName: string;
    category: string | null;
};

export type SiteFeedBuildResult = {
    title: string;
    description: string;
    language: string;
    updated: string;
    entries: SiteFeedEntry[];
};

export type BuildSiteFeedOptions = {
    site: URL;
    resolvedSiteSettings?: ResolvedSiteSettings;
};

function normalizeIdentity(value: string | null | undefined): string {
    return String(value || "").trim();
}

function toSafeDate(value: string | null | undefined): Date | null {
    const parsed = new Date(String(value || ""));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildFallbackAuthorName(authorId: string): string {
    const normalizedAuthorId = normalizeIdentity(authorId);
    return normalizedAuthorId
        ? `user-${normalizedAuthorId.slice(0, 8)}`
        : "Member";
}

function mapFeedSourceRow(
    row: FeedSourceRow,
    authorName: string,
): FeedSourceEntry | null {
    const articleId = normalizeIdentity(row.id);
    const shortId = normalizeIdentity(row.short_id) || null;
    const routeId = shortId || articleId;
    const rawBody = String(row.body_markdown || "");
    const published = toSafeDate(row.date_created);
    const updated = toSafeDate(row.date_updated || row.date_created);
    if (
        !articleId ||
        !routeId ||
        isProtectedContentBody(rawBody) ||
        !published ||
        !updated
    ) {
        return null;
    }

    return {
        id: routeId,
        title: String(row.title || "").trim() || routeId,
        summary: String(row.summary || "").trim(),
        body: rawBody,
        link: buildPostUrl(shortId, articleId),
        published,
        updated,
        authorName,
        category: normalizeIdentity(row.category) || null,
    } satisfies FeedSourceEntry;
}

async function loadFeedSourceEntries(): Promise<FeedSourceEntry[]> {
    return await runWithDirectusServiceAccess(async () => {
        const rows = (await readMany("app_articles", {
            filter: {
                _and: [filterPublicStatus(), excludeSpecialArticleSlugFilter()],
            } as JsonObject,
            fields: [
                "id",
                "short_id",
                "author_id",
                "title",
                "summary",
                "body_markdown",
                "category",
                "date_created",
                "date_updated",
            ],
            sort: ["-date_updated", "-date_created"],
            limit: -1,
        })) as FeedSourceRow[];

        const authorIds = Array.from(
            new Set(
                rows
                    .map((row) => normalizeIdentity(row.author_id))
                    .filter(Boolean),
            ),
        );
        const authorMap = await getAuthorBundle(authorIds);

        return rows
            .map((row) => {
                const authorId = normalizeIdentity(row.author_id);
                return mapFeedSourceRow(
                    row,
                    authorMap.get(authorId)?.name ||
                        buildFallbackAuthorName(authorId),
                );
            })
            .filter((entry): entry is FeedSourceEntry => entry !== null);
    });
}

async function renderFeedEntry(
    post: FeedSourceEntry,
    site: URL,
): Promise<SiteFeedEntry> {
    return {
        title: post.title,
        summary: post.summary,
        link: post.link,
        content: await renderMarkdown(post.body, {
            target: "feed",
            site,
        }),
        published: post.published,
        updated: post.updated,
        authorName: post.authorName,
        category: post.category,
    };
}

export async function listSiteFeedPreviewEntries(
    limit: number,
): Promise<SiteFeedPreviewEntry[]> {
    const normalizedLimit = Math.max(0, Math.trunc(limit));
    if (normalizedLimit === 0) {
        return [];
    }

    const entries = await loadFeedSourceEntries();
    return entries.slice(0, normalizedLimit).map((entry) => ({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        url: entry.link,
        published: entry.published,
    }));
}

export async function buildSiteFeed(
    options: BuildSiteFeedOptions,
): Promise<SiteFeedBuildResult> {
    const resolvedSiteSettings =
        options.resolvedSiteSettings ?? (await getResolvedSiteSettings());
    const settings = resolvedSiteSettings.settings;
    const system = resolvedSiteSettings.system;
    const posts = await loadFeedSourceEntries();

    // Feed 只保留一条轻量读取链路，Markdown 渲染再并发执行，避免串行阻塞。
    const entries = await Promise.all(
        posts.map(async (post) => await renderFeedEntry(post, options.site)),
    );

    return {
        title: settings.site.title,
        description: settings.site.subtitle || "No description",
        language: system.lang,
        updated: new Date().toISOString(),
        entries,
    };
}
