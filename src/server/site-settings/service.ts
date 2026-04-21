import { defaultSiteSettings, systemSiteConfig } from "@/config";
import {
    resolveSiteThemePreset,
    resolveThemeColorFromPreset,
} from "@/config/theme-presets";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import type {
    PublicSiteSettings,
    ResolvedSiteSettings,
    SiteSettingsPayload,
} from "@/types/site-settings";
import { resolveEffectiveSiteTimeZone } from "@/utils/date-utils";
import {
    isRecord,
    isSiteLanguageOption,
    normalizeAnnouncement,
    normalizeAiSettings,
    normalizeBannerBasic,
    normalizeBannerHomeText,
    normalizeBannerNavbar,
    normalizeMusicPlayer,
    normalizeNavBarLinks,
    normalizeNavbarTitle,
    normalizeProfile,
    normalizeSiteFavicon,
    normalizeSiteInfo,
    normalizeToc,
    readRawBannerSrc,
} from "./normalize-helpers";
import {
    composeSiteSettingsFromStorageSections,
    type StoredSiteSettingsSectionSources,
} from "./storage-sections";

type SiteSettingsCacheValue = {
    resolved: ResolvedSiteSettings;
    updatedAt: string | null;
};

type SiteSettingsFailureFallback = {
    expiresAt: number;
    resolved: ResolvedSiteSettings;
};

const LEGACY_SETTINGS_TOP_LEVEL_KEYS = [
    "analytics",
    "featurePages",
    "footer",
    "license",
    "sakura",
    "sidebarLayout",
    "umami",
] as const;

const SITE_SETTINGS_FAILURE_BACKOFF_MS = 5_000;
const ANNOUNCEMENT_QUERY_FIELDS = [
    "id",
    "key",
    "title",
    "summary",
    "body_markdown",
    "closable",
    "status",
    "date_updated",
    "date_created",
] as const;

let recentFailureFallback: SiteSettingsFailureFallback | null = null;
let lastKnownGood: ResolvedSiteSettings | null = null;

function cloneSettings(settings: SiteSettingsPayload): SiteSettingsPayload {
    return structuredClone(settings);
}

function mergeWithDefaults<T>(defaults: T, patch: unknown): T {
    if (Array.isArray(defaults)) {
        return (Array.isArray(patch) ? patch : defaults) as T;
    }
    if (isRecord(defaults)) {
        if (!isRecord(patch)) {
            return defaults;
        }
        const defaultsRecord = defaults as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        const keys = new Set<string>([
            ...Object.keys(defaultsRecord),
            ...Object.keys(patch),
        ]);
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(defaultsRecord, key)) {
                result[key] = mergeWithDefaults(
                    defaultsRecord[key],
                    patch[key],
                );
                continue;
            }
            result[key] = structuredClone(patch[key]);
        }
        return result as T;
    }
    switch (typeof defaults) {
        case "string":
            return (typeof patch === "string" ? patch : defaults) as T;
        case "number":
            return (typeof patch === "number" ? patch : defaults) as T;
        case "boolean":
            return (typeof patch === "boolean" ? patch : defaults) as T;
        default:
            return defaults;
    }
}

function normalizeAnnouncementPayload(
    raw: unknown,
    fallback: SiteSettingsPayload["announcement"],
): SiteSettingsPayload["announcement"] {
    const source = isRecord(raw) ? raw : {};
    return {
        title: String(source.title ?? fallback.title ?? "").trim(),
        summary: String(source.summary ?? fallback.summary ?? "").trim(),
        body_markdown: String(
            source.body_markdown ?? fallback.body_markdown ?? "",
        ).trim(),
        closable: Boolean(source.closable ?? fallback.closable),
    };
}

function pickLatestUpdatedAt(
    left: string | null,
    right: string | null,
): string | null {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    const leftEpoch = Date.parse(left);
    const rightEpoch = Date.parse(right);
    if (!Number.isFinite(leftEpoch)) {
        return right;
    }
    if (!Number.isFinite(rightEpoch)) {
        return left;
    }
    return leftEpoch >= rightEpoch ? left : right;
}

function readExplicitSiteTimeZonePatch(raw: unknown): {
    hasValue: boolean;
    value: SiteSettingsPayload["site"]["timeZone"];
} {
    if (!isRecord(raw) || !isRecord(raw.site)) {
        return { hasValue: false, value: null };
    }
    if (!Object.prototype.hasOwnProperty.call(raw.site, "timeZone")) {
        return { hasValue: false, value: null };
    }

    const rawValue = raw.site.timeZone;
    if (rawValue === null || rawValue === undefined) {
        return { hasValue: true, value: null };
    }

    return { hasValue: true, value: String(rawValue) };
}

function normalizeSettings(
    raw: unknown,
    base: SiteSettingsPayload,
): SiteSettingsPayload {
    const merged = mergeWithDefaults(cloneSettings(base), raw);
    const rawBannerSrc = readRawBannerSrc(raw);
    const explicitSiteTimeZone = readExplicitSiteTimeZonePatch(raw);

    // `site.timeZone` 是 string | null，可空字段会被通用 merge 逻辑吞掉，
    // 这里需要在归一化前显式回灌一次原始补丁值。
    if (explicitSiteTimeZone.hasValue) {
        merged.site.timeZone = explicitSiteTimeZone.value;
    }

    normalizeSiteInfo(merged, base);
    merged.site.themePreset = resolveSiteThemePreset(merged.site.themePreset);
    normalizeSiteFavicon(merged);
    merged.auth.register_enabled = Boolean(
        merged.auth.register_enabled ?? base.auth.register_enabled,
    );
    normalizeNavbarTitle(merged, base);
    merged.wallpaperMode.defaultMode =
        merged.wallpaperMode.defaultMode === "none" ? "none" : "banner";
    normalizeBannerBasic(merged, base, rawBannerSrc);
    normalizeBannerHomeText(merged, base);
    normalizeBannerNavbar(merged, base);
    normalizeToc(merged);
    normalizeNavBarLinks(merged);
    normalizeProfile(merged, base);
    normalizeAnnouncement(merged);
    normalizeMusicPlayer(merged);
    normalizeAiSettings(merged, base);
    const mergedRecord = merged as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(mergedRecord, "sakura")) {
        // 樱花特效已废弃：读取与保存时都主动收敛，避免历史配置继续透传。
        delete mergedRecord.sakura;
    }
    if (Object.prototype.hasOwnProperty.call(mergedRecord, "analytics")) {
        // 历史统计设置字段已废弃：读取与保存时都主动收敛，防止脏数据继续透传。
        delete mergedRecord.analytics;
    }

    return merged;
}

function buildSystemSiteConfig(
    settings: SiteSettingsPayload,
): ResolvedSiteSettings["system"] {
    const resolvedThemePreset = resolveSiteThemePreset(
        settings.site.themePreset,
    );
    return {
        ...systemSiteConfig,
        timeZone: resolveEffectiveSiteTimeZone(settings.site.timeZone),
        lang: isSiteLanguageOption(settings.site.lang)
            ? settings.site.lang
            : systemSiteConfig.lang,
        themeColor: resolveThemeColorFromPreset(resolvedThemePreset),
    };
}

function buildDefaultResolvedSettings(): ResolvedSiteSettings {
    const settings = cloneSettings(defaultSiteSettings);
    return {
        system: buildSystemSiteConfig(settings),
        settings,
    };
}

function hasLegacySiteSettingsFields(settings: SiteSettingsPayload): boolean {
    const settingsRecord = settings as Record<string, unknown>;
    if (
        LEGACY_SETTINGS_TOP_LEVEL_KEYS.some((key) =>
            Object.prototype.hasOwnProperty.call(settingsRecord, key),
        )
    ) {
        return true;
    }

    const bannerRecord = settings.banner as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(bannerRecord, "imageApi")) {
        return true;
    }

    const wavesRecord = (settings.banner.waves ?? {}) as Record<
        string,
        unknown
    >;
    return Object.prototype.hasOwnProperty.call(wavesRecord, "performanceMode");
}

function readRecentFailureFallback(): ResolvedSiteSettings | null {
    if (!recentFailureFallback) {
        return null;
    }
    if (recentFailureFallback.expiresAt <= Date.now()) {
        recentFailureFallback = null;
        return null;
    }
    return recentFailureFallback.resolved;
}

function writeRecentFailureFallback(resolved: ResolvedSiteSettings): void {
    recentFailureFallback = {
        expiresAt: Date.now() + SITE_SETTINGS_FAILURE_BACKOFF_MS,
        resolved,
    };
}

async function readSiteSettingsRow(): Promise<{
    sections: StoredSiteSettingsSectionSources;
    themePreset: unknown;
    updatedAt: string | null;
} | null> {
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_site_settings", {
                filter: {
                    _and: [
                        { key: { _eq: "default" } },
                        { status: { _eq: "published" } },
                    ],
                },
                limit: 1,
                sort: ["-date_updated", "-date_created"],
                fields: [
                    "id",
                    "settings_site",
                    "settings_nav",
                    "settings_home",
                    "settings_article",
                    "settings_other",
                    "theme_preset",
                    "date_updated",
                    "date_created",
                ],
            }),
    );
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        sections: {
            settings_site: row.settings_site,
            settings_nav: row.settings_nav,
            settings_home: row.settings_home,
            settings_article: row.settings_article,
            settings_other: row.settings_other,
        },
        themePreset: row.theme_preset,
        updatedAt: row.date_updated || row.date_created || null,
    };
}

async function readSiteAnnouncementRow(): Promise<{
    announcement: SiteSettingsPayload["announcement"];
    updatedAt: string | null;
} | null> {
    // 迁移期间可能出现 key/status 不一致的数据，先批量读取非归档公告，再按优先级选择最可信的记录。
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_site_announcements", {
                filter: { status: { _neq: "archived" } },
                limit: 20,
                sort: ["-date_updated", "-date_created"],
                fields: [...ANNOUNCEMENT_QUERY_FIELDS],
            }),
    );

    const candidates = rows.map((row) => ({
        payload: {
            key: String(row.key ?? ""),
            title: String(row.title ?? ""),
            summary: String(row.summary ?? ""),
            body_markdown: String(row.body_markdown ?? ""),
            closable: Boolean(row.closable),
        },
        status: String(row.status ?? ""),
        updatedAt: row.date_updated || row.date_created || null,
    }));

    const pick = (
        predicate: (candidate: (typeof candidates)[number]) => boolean,
    ): (typeof candidates)[number] | null => candidates.find(predicate) || null;

    // 选择顺序：严格命中 -> 兼容 key -> 兼容 status -> 最新非归档。
    const strict = pick(
        (candidate) =>
            candidate.payload.key === "default" &&
            candidate.status === "published",
    );
    if (strict) {
        return {
            announcement: normalizeAnnouncementPayload(
                strict.payload,
                defaultSiteSettings.announcement,
            ),
            updatedAt: strict.updatedAt,
        };
    }

    const keyDefault = pick((candidate) => candidate.payload.key === "default");
    if (keyDefault) {
        console.warn(
            "[site-settings] 公告读取未命中 published 状态，已回退到 key=default 的非归档公告。请检查迁移数据的 status。",
        );
        return {
            announcement: normalizeAnnouncementPayload(
                keyDefault.payload,
                defaultSiteSettings.announcement,
            ),
            updatedAt: keyDefault.updatedAt,
        };
    }

    const published = pick((candidate) => candidate.status === "published");
    if (published) {
        console.warn(
            "[site-settings] 公告读取未命中 key=default，已回退到最新 published 公告。请检查迁移数据的 key。",
        );
        return {
            announcement: normalizeAnnouncementPayload(
                published.payload,
                defaultSiteSettings.announcement,
            ),
            updatedAt: published.updatedAt,
        };
    }

    const latest = candidates[0];
    if (latest) {
        console.warn(
            "[site-settings] 公告读取未命中 key/status 约束，已回退到最新非归档公告。请尽快修正 app_site_announcements 数据。",
        );
        return {
            announcement: normalizeAnnouncementPayload(
                latest.payload,
                defaultSiteSettings.announcement,
            ),
            updatedAt: latest.updatedAt,
        };
    }

    return null;
}

export function resolveSiteSettingsPayload(
    raw: unknown,
    base: SiteSettingsPayload = defaultSiteSettings,
): SiteSettingsPayload {
    return normalizeSettings(raw, base);
}

const loadResolvedSiteSettingsSingleFlight = createSingleFlightRunner(
    async (): Promise<ResolvedSiteSettings> => {
        const defaultResolved = buildDefaultResolvedSettings();
        try {
            const [siteRow, announcementRow] = await Promise.all([
                readSiteSettingsRow(),
                readSiteAnnouncementRow(),
            ]);
            if (!siteRow && !announcementRow) {
                const value: SiteSettingsCacheValue = {
                    resolved: defaultResolved,
                    updatedAt: null,
                };
                lastKnownGood = defaultResolved;
                recentFailureFallback = null;
                void cacheManager.set("site-settings", "default", value);
                return defaultResolved;
            }

            const settings = siteRow
                ? normalizeSettings(
                      composeSiteSettingsFromStorageSections(siteRow.sections),
                      defaultSiteSettings,
                  )
                : cloneSettings(defaultSiteSettings);
            settings.site.themePreset = resolveSiteThemePreset(
                siteRow?.themePreset,
            );
            settings.announcement =
                announcementRow?.announcement ||
                normalizeAnnouncementPayload(
                    null,
                    defaultSiteSettings.announcement,
                );
            const resolved: ResolvedSiteSettings = {
                system: buildSystemSiteConfig(settings),
                settings,
            };
            const value: SiteSettingsCacheValue = {
                resolved,
                updatedAt: pickLatestUpdatedAt(
                    siteRow?.updatedAt || null,
                    announcementRow?.updatedAt || null,
                ),
            };
            lastKnownGood = resolved;
            recentFailureFallback = null;
            void cacheManager.set("site-settings", "default", value);
            return resolved;
        } catch (error) {
            // 短暂上游抖动时，使用短 TTL 退避，避免多个实例同时击穿 Directus。
            console.error("[site-settings] 拉取设置失败，进入短暂退避:", error);
            const fallbackValue = lastKnownGood ?? defaultResolved;
            writeRecentFailureFallback(fallbackValue);
            return fallbackValue;
        }
    },
    () => "default",
);

export async function getResolvedSiteSettings(): Promise<ResolvedSiteSettings> {
    const cached = await cacheManager.get<SiteSettingsCacheValue>(
        "site-settings",
        "default",
    );
    if (cached) {
        lastKnownGood = cached.resolved;
        return cached.resolved;
    }

    const fallback = readRecentFailureFallback();
    if (fallback) {
        return fallback;
    }

    return await loadResolvedSiteSettingsSingleFlight();
}

export async function resolveRequestSiteSettings(
    initial: ResolvedSiteSettings | null | undefined,
): Promise<ResolvedSiteSettings> {
    if (initial && !hasLegacySiteSettingsFields(initial.settings)) {
        return initial;
    }

    // 开发态热更新下，Astro.locals.siteSettings 可能短暂保留旧 schema。
    // 发现 legacy 字段时直接回源当前规范化后的设置，避免页面 SSR 与 API 返回不一致。
    return await getResolvedSiteSettings();
}

export async function getPublicSiteSettings(): Promise<{
    settings: PublicSiteSettings;
    updatedAt: string | null;
}> {
    const resolved = await getResolvedSiteSettings();
    const cached = await cacheManager.get<SiteSettingsCacheValue>(
        "site-settings",
        "default",
    );
    return {
        settings: resolved.settings,
        updatedAt: cached?.updatedAt || null,
    };
}

export async function invalidateSiteSettingsCache(): Promise<void> {
    await cacheManager.invalidate("site-settings", "default");
}
