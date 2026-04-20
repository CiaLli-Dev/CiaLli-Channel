/** 缓存域标识，每个域拥有独立的 TTL 策略和容量上限 */
export type CacheDomain =
    | "author"
    | "site-settings"
    | "banner-images"
    | "sidebar"
    | "profile-viewer"
    | "article-list"
    | "article-taxonomy"
    | "article-detail"
    | "article-public"
    | "article-interaction"
    | "diary-interaction"
    | "diary-list"
    | "diary-detail"
    | "mixed-feed"
    | "album-list"
    | "album-detail"
    | "bangumi-list"
    | "user-home"
    | "session-user"
    | "markdown";

/** 缓存策略：L1 = 内存，L2 = Redis */
export type CacheStrategy = {
    /** 内存缓存 TTL（毫秒），0 = 不缓存 */
    l1TtlMs: number;
    /** Redis 缓存 TTL（毫秒），0 = 不缓存 */
    l2TtlMs: number;
    /** 内存缓存条目上限 */
    l1MaxEntries: number;
};

/** 缓存命中/未命中计数 */
export type CacheMetrics = {
    l1Hits: number;
    l1Misses: number;
    l2Hits: number;
    l2Misses: number;
    sets: number;
    invalidations: number;
};
