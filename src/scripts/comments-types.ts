export type CommentAuthor = {
    name?: string | null;
    display_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
};

export type CommentItem = {
    id: string;
    author_id?: string | null;
    author?: CommentAuthor | null;
    like_count?: number | null;
    liked_by_viewer?: boolean | null;
    date_created?: string | null;
    body?: string | null;
    body_html?: string | null;
    replies?: CommentItem[] | null;
};

export type CommentMode = "edit" | "preview";
export type CommentSortMode = "created_at" | "like_count";
export type TimeSortDirection = "asc" | "desc";
export type CommentReplyCollapseScope = "top_level_only";
export type TopLevelReplyExpandState = Record<string, boolean>;
export type CommentToolbarAction =
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "quote"
    | "inline-code"
    | "code-block";

export const TOOLBAR_ACTIONS = new Set<CommentToolbarAction>([
    "bold",
    "italic",
    "underline",
    "strike",
    "quote",
    "inline-code",
    "code-block",
]);

export const TOP_LEVEL_REPLY_VISIBLE_LIMIT = 2;
export const REPLY_COLLAPSE_SCOPE: CommentReplyCollapseScope = "top_level_only";
