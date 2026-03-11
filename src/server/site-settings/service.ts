import { defaultSiteSettings, systemSiteConfig } from "@/config";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";
import { createSingleFlightRunner } from "@/server/utils/single-flight";
import type {
    EditableSiteSettings,
    PublicSiteSettings,
    ResolvedSiteSettings,
    SiteSettingsPayload,
} from "@/types/site-settings";
import { resolveEffectiveSiteTimeZone } from "@/utils/date-utils";
import {
    isRecord,
    isSiteLanguageOption,
    normalizeAnnouncement,
    normalizeAnalytics,
    normalizeBannerBasic,
    normalizeBannerHomeText,
    normalizeBannerImageApi,
    normalizeBannerNavbar,
    normalizeLicense,
    normalizeMusicPlayer,
    normalizeNavBarLinks,
    normalizeNavbarTitle,
    normalizeProfile,
    normalizeSiteFavicon,
    normalizeSiteInfo,
    normalizeToc,
    normalizeUmami,
    readRawBannerSrc,
} from "./normalize-helpers";

type SiteSettingsCacheValue = {
    resolved: ResolvedSiteSettings;
    updatedAt: string | null;
};

type SiteSettingsFailureFallback = {
    expiresAt: number;
    resolved: ResolvedSiteSettings;
};

const SITE_SETTINGS_FAILURE_BACKOFF_MS = 5_000;

let recentFailureFallback: SiteSettingsFailureFallback | null = null;

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
    normalizeSiteFavicon(merged);
    merged.auth.register_enabled = Boolean(
        merged.auth.register_enabled ?? base.auth.register_enabled,
    );
    normalizeNavbarTitle(merged, base);
    merged.wallpaperMode.defaultMode =
        merged.wallpaperMode.defaultMode === "none" ? "none" : "banner";
    normalizeBannerBasic(merged, base, rawBannerSrc);
    normalizeBannerImageApi(merged, base);
    normalizeBannerHomeText(merged, base);
    normalizeBannerNavbar(merged, base);
    normalizeToc(merged);
    normalizeNavBarLinks(merged);
    normalizeProfile(merged, base);
    normalizeLicense(merged, base);
    normalizeAnnouncement(merged);
    normalizeMusicPlayer(merged);
    merged.sakura.enable = Boolean(merged.sakura.enable);
    normalizeUmami(merged);
    normalizeAnalytics(merged, base);

    return merged;
}

function buildSystemSiteConfig(
    settings: SiteSettingsPayload,
): ResolvedSiteSettings["system"] {
    return {
        ...systemSiteConfig,
        timeZone: resolveEffectiveSiteTimeZone(settings.site.timeZone),
        lang: isSiteLanguageOption(settings.site.lang)
            ? settings.site.lang
            : systemSiteConfig.lang,
    };
}

function buildDefaultResolvedSettings(): ResolvedSiteSettings {
    const settings = cloneSettings(defaultSiteSettings);
    return {
        system: buildSystemSiteConfig(settings),
        settings,
    };
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
    settings: unknown;
    updatedAt: string | null;
} | null> {
    const rows = await readMany("app_site_settings", {
        filter: {
            _and: [
                { key: { _eq: "default" } },
                { status: { _eq: "published" } },
            ],
        },
        limit: 1,
        sort: ["-date_updated", "-date_created"],
        fields: ["id", "settings", "date_updated", "date_created"],
    });
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        settings: row.settings,
        updatedAt: row.date_updated || row.date_created || null,
    };
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
            const row = await readSiteSettingsRow();
            if (!row) {
                const value: SiteSettingsCacheValue = {
                    resolved: defaultResolved,
                    updatedAt: null,
                };
                recentFailureFallback = null;
                void cacheManager.set("site-settings", "default", value);
                return defaultResolved;
            }

            const settings = normalizeSettings(
                row.settings,
                defaultSiteSettings,
            );
            const resolved: ResolvedSiteSettings = {
                system: buildSystemSiteConfig(settings),
                settings,
            };
            const value: SiteSettingsCacheValue = {
                resolved,
                updatedAt: row.updatedAt,
            };
            recentFailureFallback = null;
            void cacheManager.set("site-settings", "default", value);
            return resolved;
        } catch (error) {
            // 短暂上游抖动时，使用短 TTL 退避，避免多个实例同时击穿 Directus。
            console.error("[site-settings] 拉取设置失败，进入短暂退避:", error);
            writeRecentFailureFallback(defaultResolved);
            return defaultResolved;
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
        return cached.resolved;
    }

    const fallback = readRecentFailureFallback();
    if (fallback) {
        return fallback;
    }

    return await loadResolvedSiteSettingsSingleFlight();
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

export function invalidateSiteSettingsCache(): void {
    void cacheManager.invalidate("site-settings", "default");
}

export async function mergeSiteSettingsPatch(
    patch: Partial<EditableSiteSettings>,
): Promise<SiteSettingsPayload> {
    const current = await getResolvedSiteSettings();
    return normalizeSettings(patch, current.settings);
}
