import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { cacheManager } from "@/server/cache/manager";
import { hashParams } from "@/server/cache/key-utils";
import { countItems, readMany } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";

import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
    isSpecialArticleSlug,
    loadPublicArticleById,
    loadPublicArticleBySlug,
    parseRouteId,
    safeCsv,
} from "../shared";
import { getAuthorBundle } from "../shared/author-cache";
import {
    normalizeAuthorHandle,
    readAuthor,
    loadProfileByUsername,
} from "./_helpers";

async function buildArticleListFilters(
    context: APIContext,
    page: number,
    limit: number,
): Promise<{ filters: JsonObject[]; earlyReturn?: Response }> {
    const tag = (context.url.searchParams.get("tag")?.trim() || "").slice(
        0,
        200,
    );
    const category = (
        context.url.searchParams.get("category")?.trim() || ""
    ).slice(0, 200);
    const q = (context.url.searchParams.get("q")?.trim() || "").slice(0, 200);
    const authorHandle = normalizeAuthorHandle(
        (context.url.searchParams.get("author") || "").slice(0, 100),
    );

    const andFilters: JsonObject[] = [
        filterPublicStatus(),
        excludeSpecialArticleSlugFilter(),
    ];

    if (authorHandle) {
        const profile = await loadProfileByUsername(authorHandle);
        if (!profile?.user_id) {
            return {
                filters: andFilters,
                earlyReturn: ok({ items: [], page, limit, total: 0 }),
            };
        }
        andFilters.push({ author_id: { _eq: profile.user_id } });
    }
    if (tag) {
        andFilters.push({ tags: { _contains: tag } });
    }
    if (category) {
        andFilters.push({ category: { _eq: category } });
    }
    if (q) {
        andFilters.push({
            _or: [{ title: { _icontains: q } }, { summary: { _icontains: q } }],
        });
    }

    return { filters: andFilters };
}

async function handleArticleList(context: APIContext): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const tag = (context.url.searchParams.get("tag")?.trim() || "").slice(
        0,
        200,
    );
    const category = (
        context.url.searchParams.get("category")?.trim() || ""
    ).slice(0, 200);
    const q = (context.url.searchParams.get("q")?.trim() || "").slice(0, 200);
    const authorHandle = normalizeAuthorHandle(
        (context.url.searchParams.get("author") || "").slice(0, 100),
    );

    const cacheKey = hashParams({
        page,
        limit,
        tag,
        category,
        q,
        author: authorHandle,
    });
    const cached = await cacheManager.get<unknown>("article-list", cacheKey);
    if (cached) return ok(cached);

    const { filters, earlyReturn } = await buildArticleListFilters(
        context,
        page,
        limit,
    );
    if (earlyReturn) return earlyReturn;

    const filter = { _and: filters } as JsonObject;
    const [rows, total] = await Promise.all([
        readMany("app_articles", {
            filter,
            sort: ["-date_updated", "-date_created"],
            limit,
            offset,
        }),
        countItems("app_articles", filter),
    ]);

    const authorIds = Array.from(
        new Set(rows.map((row) => row.author_id).filter(Boolean)),
    );
    const authorMap = await getAuthorBundle(authorIds);

    const items = rows.map((row) => ({
        ...row,
        tags: safeCsv(row.tags),
        author: readAuthor(authorMap, row.author_id),
    }));

    const result = { items, page, limit, total };
    void cacheManager.set("article-list", cacheKey, result);
    return ok(result);
}

async function handleArticleDetail(segments: string[]): Promise<Response> {
    const articleId = parseRouteId(segments[2]);
    if (!articleId) {
        return fail("缺少文章 ID", 400);
    }

    const cached = await cacheManager.get<unknown>("article-detail", articleId);
    if (cached) return ok(cached);

    const articleById = await loadPublicArticleById(articleId);
    const article =
        articleById ||
        (isSpecialArticleSlug(articleId)
            ? await loadPublicArticleBySlug(articleId)
            : null);
    if (!article) {
        return fail("文章不存在", 404);
    }
    const authorMap = await getAuthorBundle([article.author_id]);
    const result = {
        item: {
            ...article,
            tags: safeCsv(article.tags),
            author: readAuthor(authorMap, article.author_id),
        },
    };
    void cacheManager.set("article-detail", articleId, result);
    return ok(result);
}

export async function handlePublicArticles(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }

    if (segments.length === 2) {
        return handleArticleList(context);
    }

    if (segments.length === 3) {
        return handleArticleDetail(segments);
    }

    return fail("未找到接口", 404);
}
