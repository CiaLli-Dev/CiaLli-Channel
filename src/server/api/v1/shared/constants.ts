export const DEFAULT_LIST_LIMIT = 20;

export const ARTICLE_FIELDS = [
    "id",
    "short_id",
    "author_id",
    "status",
    "title",
    "slug",
    "summary",
    "body_markdown",
    "cover_file",
    "cover_url",
    "tags",
    "category",
    "allow_comments",
    "is_public",
    "date_created",
    "date_updated",
] as const;

export const FRIEND_FIELDS = [
    "id",
    "sort",
    "title",
    "description",
    "site_url",
    "avatar_file",
    "tags",
    "is_public",
    "date_created",
    "date_updated",
] as const;

export const DIARY_FIELDS = [
    "id",
    "short_id",
    "author_id",
    "status",
    "content",
    "allow_comments",
    "praviate",
    "date_created",
    "date_updated",
] as const;

export const ADMIN_MODULE_COLLECTION = {
    articles: "app_articles",
    diaries: "app_diaries",
    albums: "app_albums",
    "article-comments": "app_article_comments",
    "diary-comments": "app_diary_comments",
} as const;
