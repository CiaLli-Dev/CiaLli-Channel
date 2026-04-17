import type { AppArticle } from "@/types/app";
import type { JsonObject } from "@/types/json";
import {
    excludeSpecialArticleSlugFilter,
    filterPublicStatus,
} from "@/server/api/v1/shared";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";

type PostAuthor = {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    avatar_url?: string;
};

export type DirectusPostEntry = {
    id: string;
    slug: string | null;
    body: string;
    url: string;
    data: {
        article_id: string;
        author_id: string;
        author: PostAuthor;
        title: string;
        description?: string;
        image?: string;
        tags: string[];
        category?: string;
        comment_count: number;
        like_count: number;
        published: Date;
        updated: Date;
        nextSlug?: string;
        nextTitle?: string;
        prevSlug?: string;
        prevTitle?: string;
        alias?: string;
        permalink?: string;
        encrypted?: boolean;
    };
};

export function resolveArticleDisplayTitle(
    article: Pick<AppArticle, "title" | "status" | "slug" | "id">,
): string {
    const title = String(article.title || "").trim();
    if (title) {
        return title;
    }
    if (article.status === "draft") {
        return i18n(I18nKey.contentArticleNewDraftTitle);
    }
    const slug = String(article.slug || "").trim();
    return (
        slug || String(article.id || "").trim() || i18n(I18nKey.contentUntitled)
    );
}

export function buildVisiblePostsFilter(viewerId?: string | null): JsonObject {
    const publicBranch = {
        _and: [filterPublicStatus(), excludeSpecialArticleSlugFilter()],
    } satisfies JsonObject;
    const normalizedViewerId = String(viewerId || "").trim();
    if (!normalizedViewerId) {
        return publicBranch;
    }
    return {
        _or: [
            publicBranch,
            {
                _and: [
                    { author_id: { _eq: normalizedViewerId } },
                    { status: { _eq: "draft" } },
                    excludeSpecialArticleSlugFilter(),
                ],
            },
        ],
    } satisfies JsonObject;
}
