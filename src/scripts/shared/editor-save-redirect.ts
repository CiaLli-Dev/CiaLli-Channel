import { appendEditorSaveFreshnessParam } from "@/utils/editor-save-freshness";

export const ARTICLE_SAVE_SUCCESS_REDIRECT_URL = "/posts";

type SavedContentRouteItem = {
    id?: unknown;
    short_id?: unknown;
    slug?: unknown;
};

type SaveSuccessRedirectOptions = {
    fresh?: boolean;
    freshnessToken?: string;
};

function toRouteSegment(value: unknown): string {
    return String(value ?? "").trim();
}

function applyFreshnessOption(
    url: string,
    options?: SaveSuccessRedirectOptions,
): string {
    if (!options?.fresh) {
        return url;
    }
    return appendEditorSaveFreshnessParam(url, options.freshnessToken);
}

export function buildDiarySaveSuccessRedirectUrl(
    username: string,
    options?: SaveSuccessRedirectOptions,
): string {
    return applyFreshnessOption(
        `/${encodeURIComponent(username)}/diary`,
        options,
    );
}

export function buildArticleDetailSuccessRedirectUrl(
    item: SavedContentRouteItem,
    options?: SaveSuccessRedirectOptions,
): string {
    const routeId =
        toRouteSegment(item.slug) ||
        toRouteSegment(item.short_id) ||
        toRouteSegment(item.id);
    return routeId
        ? applyFreshnessOption(`/posts/${encodeURIComponent(routeId)}`, options)
        : "";
}

export function buildDiaryDetailSuccessRedirectUrl(
    username: string,
    item: SavedContentRouteItem,
    options?: SaveSuccessRedirectOptions,
): string {
    const normalizedUsername = toRouteSegment(username);
    const routeId = toRouteSegment(item.short_id) || toRouteSegment(item.id);
    if (!normalizedUsername || !routeId) {
        return "";
    }
    return applyFreshnessOption(
        `/${encodeURIComponent(normalizedUsername)}/diary/${encodeURIComponent(routeId)}`,
        options,
    );
}
