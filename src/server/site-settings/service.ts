import { defaultSiteSettings, systemSiteConfig } from "@/config";
import { cacheManager } from "@/server/cache/manager";
import { buildDirectusAssetUrl } from "@/server/directus-auth";
import { readMany } from "@/server/directus/client";
import type {
    EditableSiteSettings,
    PublicSiteSettings,
    ResolvedSiteSettings,
    SiteSettingsPayload,
} from "@/types/site-settings";

type SiteSettingsCacheValue = {
    resolved: ResolvedSiteSettings;
    updatedAt: string | null;
};

const SITE_LANGUAGE_OPTIONS = ["en", "zh_CN", "zh_TW", "ja"] as const;
type SiteLanguageOption = (typeof SITE_LANGUAGE_OPTIONS)[number];

function isSiteLanguageOption(value: unknown): value is SiteLanguageOption {
    return (
        typeof value === "string" &&
        SITE_LANGUAGE_OPTIONS.includes(value as SiteLanguageOption)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function clampInteger(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isSafeNavigationUrl(url: string, allowHash = false): boolean {
    if (!url) {
        return false;
    }
    if (allowHash && url === "#") {
        return true;
    }
    if (url.startsWith("/") && !url.startsWith("//")) {
        return true;
    }
    return /^https?:\/\//.test(url);
}

const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
];

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "[::1]",
    "metadata.google.internal",
]);

function isSafeExternalUrl(url: string): boolean {
    if (!url) {
        return false;
    }
    if (!/^https:\/\//.test(url)) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) {
        return false;
    }
    for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
            return false;
        }
    }
    return true;
}

function normalizeAssetPath(
    input: string,
    fallback: string,
    allowEmpty = false,
): string {
    const value = String(input || "").trim();
    if (!value) {
        return allowEmpty ? "" : fallback;
    }
    if (isLikelyDirectusFileId(value)) {
        return buildDirectusAssetUrl(value);
    }
    if (value.startsWith("/") && !value.startsWith("//")) {
        return value;
    }
    if (value.startsWith("assets/")) {
        return value;
    }
    if (/^https?:\/\//.test(value)) {
        return value;
    }
    return fallback;
}

function isLikelyDirectusFileId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
    );
}

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i;
const CLARITY_ID_PATTERN = /^[a-z0-9]{4,64}$/i;
const SITE_PROFILE_AVATAR_PATH = "assets/images/avatar.webp";

function normalizeAnalyticsId(
    value: unknown,
    fallback: string,
    pattern: RegExp,
): string {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return "";
    }
    return pattern.test(raw) ? raw : fallback;
}

type NavLinkLike = {
    name: string;
    url: string;
    external?: boolean;
    icon?: string;
    children?: NavLinkLike[];
};

function normalizeNavLink(link: unknown): NavLinkLike | null {
    if (!isRecord(link)) {
        return null;
    }
    const name = String(link.name || "").trim();
    const url = String(link.url || "").trim();
    if (!name || !isSafeNavigationUrl(url, true)) {
        return null;
    }
    const output: NavLinkLike = {
        name,
        url,
    };
    if (typeof link.external === "boolean") {
        output.external = link.external;
    }
    if (typeof link.icon === "string" && link.icon.trim()) {
        output.icon = link.icon.trim();
    }
    if (Array.isArray(link.children)) {
        const children = link.children
            .map((entry) => normalizeNavLink(entry))
            .filter((entry): entry is NavLinkLike => Boolean(entry));
        if (children.length > 0) {
            output.children = children;
        }
    }
    return output;
}

function normalizeBannerSrc(
    value: unknown,
    fallback: SiteSettingsPayload["banner"]["src"],
): SiteSettingsPayload["banner"]["src"] {
    if (typeof value === "string") {
        return normalizeAssetPath(value, "", true);
    }
    if (Array.isArray(value)) {
        const entries = value
            .map((entry) => normalizeAssetPath(String(entry || ""), "", true))
            .filter(Boolean);
        return entries.length > 0 ? entries : "";
    }
    return fallback;
}

function readRawBannerSrc(raw: unknown): unknown {
    if (!isRecord(raw)) {
        return undefined;
    }
    const banner = raw.banner;
    if (!isRecord(banner)) {
        return undefined;
    }
    return banner.src;
}

function normalizeSettings(
    raw: unknown,
    base: SiteSettingsPayload,
): SiteSettingsPayload {
    const merged = mergeWithDefaults(cloneSettings(base), raw);

    merged.site.title =
        String(merged.site.title || base.site.title).trim() || base.site.title;
    merged.site.subtitle = String(
        merged.site.subtitle || base.site.subtitle,
    ).trim();
    merged.site.lang = isSiteLanguageOption(merged.site.lang)
        ? merged.site.lang
        : base.site.lang;
    merged.site.keywords = Array.isArray(merged.site.keywords)
        ? merged.site.keywords
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 32)
        : base.site.keywords;
    merged.site.siteStartDate = merged.site.siteStartDate
        ? String(merged.site.siteStartDate).trim()
        : null;
    const normalizedFavicons = Array.isArray(merged.site.favicon)
        ? merged.site.favicon
              .map((item) => {
                  if (!isRecord(item)) {
                      return null;
                  }
                  const src = normalizeAssetPath(
                      String(item.src || ""),
                      "",
                      true,
                  );
                  if (!src) {
                      return null;
                  }
                  return {
                      src,
                      theme:
                          item.theme === "light" || item.theme === "dark"
                              ? item.theme
                              : undefined,
                      sizes:
                          typeof item.sizes === "string" && item.sizes.trim()
                              ? item.sizes.trim()
                              : undefined,
                  };
              })
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [];
    merged.site.favicon = normalizedFavicons.slice(0, 8);

    merged.auth.register_enabled = Boolean(
        merged.auth.register_enabled ?? base.auth.register_enabled,
    );

    merged.navbarTitle.text =
        String(merged.navbarTitle.text || base.navbarTitle.text).trim() ||
        base.navbarTitle.text;
    merged.navbarTitle.mode =
        merged.navbarTitle.mode === "text-icon" ? "text-icon" : "logo";
    merged.navbarTitle.icon = normalizeAssetPath(
        String(merged.navbarTitle.icon || ""),
        base.navbarTitle.icon || "assets/home/home.png",
    );
    merged.navbarTitle.logo = normalizeAssetPath(
        String(merged.navbarTitle.logo || ""),
        base.navbarTitle.logo || "assets/home/default-logo.png",
    );

    merged.wallpaperMode.defaultMode =
        merged.wallpaperMode.defaultMode === "none" ? "none" : "banner";

    const rawBannerSrc = readRawBannerSrc(raw);
    merged.banner.src = normalizeBannerSrc(
        rawBannerSrc !== undefined ? rawBannerSrc : merged.banner.src,
        base.banner.src,
    );
    merged.banner.position =
        merged.banner.position === "top" ||
        merged.banner.position === "bottom" ||
        merged.banner.position === "center"
            ? merged.banner.position
            : base.banner.position;
    merged.banner.carousel = {
        enable: Boolean(
            merged.banner.carousel?.enable ?? base.banner.carousel?.enable,
        ),
        interval: clampInteger(
            merged.banner.carousel?.interval,
            base.banner.carousel?.interval ?? 5,
            1,
            120,
        ),
    };
    merged.banner.waves = {
        enable: Boolean(
            merged.banner.waves?.enable ?? base.banner.waves?.enable,
        ),
        performanceMode: Boolean(
            merged.banner.waves?.performanceMode ??
            base.banner.waves?.performanceMode,
        ),
    };
    const imageApiUrl = String(
        merged.banner.imageApi?.url ?? base.banner.imageApi?.url ?? "",
    ).trim();
    merged.banner.imageApi = {
        enable: Boolean(
            merged.banner.imageApi?.enable ?? base.banner.imageApi?.enable,
        ),
        url: isSafeExternalUrl(imageApiUrl)
            ? imageApiUrl
            : String(base.banner.imageApi?.url ?? "").trim(),
    };

    const baseHomeText = base.banner.homeText ?? {
        enable: true,
        title: "",
        subtitle: [],
        typewriter: {
            enable: true,
            speed: 100,
            deleteSpeed: 50,
            pauseTime: 2000,
        },
    };
    const homeText = merged.banner.homeText ?? baseHomeText;
    const subtitle = homeText.subtitle;
    const normalizedSubtitle = Array.isArray(subtitle)
        ? subtitle.map((item) => String(item || "").trim()).filter(Boolean)
        : typeof subtitle === "string"
          ? subtitle.trim()
          : baseHomeText.subtitle;
    const baseTypewriter = baseHomeText.typewriter ?? {
        enable: true,
        speed: 100,
        deleteSpeed: 50,
        pauseTime: 2000,
    };
    const homeTypewriter = homeText.typewriter ?? baseTypewriter;
    merged.banner.homeText = {
        enable: Boolean(homeText.enable),
        title: String(homeText.title ?? baseHomeText.title ?? "").trim(),
        subtitle: normalizedSubtitle,
        typewriter: {
            enable: Boolean(homeTypewriter.enable),
            speed: clampInteger(
                homeTypewriter.speed,
                baseTypewriter.speed ?? 100,
                10,
                500,
            ),
            deleteSpeed: clampInteger(
                homeTypewriter.deleteSpeed,
                baseTypewriter.deleteSpeed ?? 50,
                10,
                500,
            ),
            pauseTime: clampInteger(
                homeTypewriter.pauseTime,
                baseTypewriter.pauseTime ?? 2000,
                100,
                10000,
            ),
        },
    };
    merged.banner.navbar = {
        transparentMode:
            merged.banner.navbar?.transparentMode === "semi" ||
            merged.banner.navbar?.transparentMode === "full" ||
            merged.banner.navbar?.transparentMode === "semifull"
                ? merged.banner.navbar.transparentMode
                : base.banner.navbar?.transparentMode || "semi",
    };

    merged.toc.enable = Boolean(merged.toc.enable);
    merged.toc.mode = merged.toc.mode === "float" ? "float" : "sidebar";
    merged.toc.depth = clampInteger(merged.toc.depth, 2, 1, 3) as 1 | 2 | 3;
    merged.toc.useJapaneseBadge = Boolean(merged.toc.useJapaneseBadge);

    const normalizedLinks = Array.isArray(merged.navBar.links)
        ? merged.navBar.links
              .map((link) => normalizeNavLink(link))
              .filter((entry): entry is NavLinkLike => Boolean(entry))
        : [];
    merged.navBar.links = normalizedLinks;
    merged.profile.avatar = SITE_PROFILE_AVATAR_PATH;
    merged.profile.name =
        String(merged.profile.name || base.profile.name).trim() ||
        base.profile.name;

    merged.license.enable = Boolean(merged.license.enable);
    merged.license.name =
        String(merged.license.name || "").trim() || base.license.name;
    merged.license.url = isSafeNavigationUrl(String(merged.license.url || ""))
        ? String(merged.license.url || "").trim()
        : base.license.url;

    merged.announcement = {
        title: String(merged.announcement.title || "").trim(),
        summary: String(merged.announcement.summary || "").trim(),
        body_markdown: String(merged.announcement.body_markdown || "").trim(),
        closable: Boolean(merged.announcement.closable),
    };

    merged.musicPlayer.enable = Boolean(merged.musicPlayer.enable);
    merged.musicPlayer.meting_api = String(
        merged.musicPlayer.meting_api || "",
    ).trim();
    merged.musicPlayer.id = String(merged.musicPlayer.id || "").trim();
    merged.musicPlayer.server = String(merged.musicPlayer.server || "").trim();
    merged.musicPlayer.type = String(merged.musicPlayer.type || "").trim();
    merged.musicPlayer.marqueeSpeed = clampInteger(
        merged.musicPlayer.marqueeSpeed,
        10,
        1,
        120,
    );

    merged.sakura.enable = Boolean(merged.sakura.enable);

    merged.umami.enabled = Boolean(merged.umami.enabled);
    merged.umami.baseUrl = String(merged.umami.baseUrl || "").trim();
    merged.umami.scripts = String(merged.umami.scripts || "").trim();
    const baseAnalytics = base.analytics ?? {
        gtmId: "",
        clarityId: "",
    };
    const mergedAnalytics = (
        isRecord(merged.analytics) ? merged.analytics : {}
    ) as Record<string, unknown>;
    merged.analytics = {
        gtmId: normalizeAnalyticsId(
            mergedAnalytics.gtmId,
            String(baseAnalytics.gtmId ?? "").trim(),
            GTM_ID_PATTERN,
        ),
        clarityId: normalizeAnalyticsId(
            mergedAnalytics.clarityId,
            String(baseAnalytics.clarityId ?? "").trim(),
            CLARITY_ID_PATTERN,
        ),
    };

    return merged;
}

function buildSystemSiteConfig(
    settings: SiteSettingsPayload,
): ResolvedSiteSettings["system"] {
    return {
        ...systemSiteConfig,
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

export async function getResolvedSiteSettings(): Promise<ResolvedSiteSettings> {
    const cached = await cacheManager.get<SiteSettingsCacheValue>(
        "site-settings",
        "default",
    );
    if (cached) {
        return cached.resolved;
    }

    const defaultResolved = buildDefaultResolvedSettings();
    try {
        const row = await readSiteSettingsRow();
        if (!row) {
            const value: SiteSettingsCacheValue = {
                resolved: defaultResolved,
                updatedAt: null,
            };
            void cacheManager.set("site-settings", "default", value);
            return defaultResolved;
        }

        const settings = normalizeSettings(row.settings, defaultSiteSettings);
        const resolved: ResolvedSiteSettings = {
            system: buildSystemSiteConfig(settings),
            settings,
        };
        const value: SiteSettingsCacheValue = {
            resolved,
            updatedAt: row.updatedAt,
        };
        void cacheManager.set("site-settings", "default", value);
        return resolved;
    } catch (error) {
        console.error("[site-settings] failed to load settings:", error);
        const value: SiteSettingsCacheValue = {
            resolved: defaultResolved,
            updatedAt: null,
        };
        void cacheManager.set("site-settings", "default", value);
        return defaultResolved;
    }
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
