import type { SiteSettingsPayload } from "@/types/site-settings";
import { buildDirectusAssetUrl } from "@/server/directus-auth";
import { canonicalizeSiteTimeZone } from "@/utils/date-utils";

// ---- 内部工具类型 ----

type NavLinkLike = {
    name: string;
    url: string;
    external?: boolean;
    icon?: string;
    children?: NavLinkLike[];
};

// ---- 内部工具函数 ----

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clampInteger(
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

const SITE_LANGUAGE_OPTIONS = ["en", "zh_CN", "zh_TW", "ja"] as const;
type SiteLanguageOption = (typeof SITE_LANGUAGE_OPTIONS)[number];

export function isSiteLanguageOption(
    value: unknown,
): value is SiteLanguageOption {
    return (
        typeof value === "string" &&
        SITE_LANGUAGE_OPTIONS.includes(value as SiteLanguageOption)
    );
}

function isLikelyDirectusFileId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
    );
}

export function normalizeAssetPath(
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

export function isSafeExternalUrl(url: string): boolean {
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

const GTM_ID_PATTERN = /^GTM-[A-Z0-9]+$/i;
const CLARITY_ID_PATTERN = /^[a-z0-9]{4,64}$/i;

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

function normalizeNavLink(link: unknown): NavLinkLike | null {
    if (!isRecord(link)) {
        return null;
    }
    const name = String(link.name || "").trim();
    const url = String(link.url || "").trim();
    if (!name || !isSafeNavigationUrl(url, true)) {
        return null;
    }
    const output: NavLinkLike = { name, url };
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

// ---- 域级 normalize 辅助函数 ----

/**
 * 规范化 site 基本信息字段（title、subtitle、lang、keywords、siteStartDate）。
 * 不包含 favicon，favicon 由 normalizeSiteFavicon 单独处理。
 */
export function normalizeSiteInfo(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    merged.site.title =
        String(merged.site.title || base.site.title).trim() || base.site.title;
    merged.site.subtitle = String(
        merged.site.subtitle || base.site.subtitle,
    ).trim();
    merged.site.lang = isSiteLanguageOption(merged.site.lang)
        ? merged.site.lang
        : base.site.lang;
    const resolvedTimeZone = canonicalizeSiteTimeZone(merged.site.timeZone);
    if (merged.site.timeZone && !resolvedTimeZone) {
        console.warn(
            `[site-settings] 检测到无效站点时区配置，已回退为跟随环境: ${String(merged.site.timeZone)}`,
        );
    }
    merged.site.timeZone = resolvedTimeZone;
    merged.site.keywords = Array.isArray(merged.site.keywords)
        ? merged.site.keywords
              .map((item) => String(item || "").trim())
              .filter(Boolean)
              .slice(0, 32)
        : base.site.keywords;
    merged.site.siteStartDate = merged.site.siteStartDate
        ? String(merged.site.siteStartDate).trim()
        : null;
}

/**
 * 规范化 site.favicon 字段（最多 8 条）。
 */
export function normalizeSiteFavicon(merged: SiteSettingsPayload): void {
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
}

/**
 * 规范化 navbarTitle 字段。
 */
export function normalizeNavbarTitle(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
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
}

/**
 * 规范化 banner.carousel 字段（enable、interval）。
 */
function normalizeBannerCarousel(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
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
}

/**
 * 规范化 banner.waves 字段（enable、performanceMode）。
 */
function normalizeBannerWaves(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    merged.banner.waves = {
        enable: Boolean(
            merged.banner.waves?.enable ?? base.banner.waves?.enable,
        ),
        performanceMode: Boolean(
            merged.banner.waves?.performanceMode ??
            base.banner.waves?.performanceMode,
        ),
    };
}

/**
 * 规范化 banner.src、banner.position、banner.carousel 和 banner.waves。
 */
export function normalizeBannerBasic(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
    rawBannerSrc: unknown,
): void {
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
    normalizeBannerCarousel(merged, base);
    normalizeBannerWaves(merged, base);
}

/**
 * 规范化 banner.imageApi 字段。
 */
export function normalizeBannerImageApi(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
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
}

type HomeTextTypewriter = NonNullable<
    NonNullable<SiteSettingsPayload["banner"]["homeText"]>["typewriter"]
>;

type HomeTextConfig = NonNullable<SiteSettingsPayload["banner"]["homeText"]>;

const DEFAULT_TYPEWRITER: HomeTextTypewriter = {
    enable: true,
    speed: 100,
    deleteSpeed: 50,
    pauseTime: 2000,
};

const DEFAULT_HOME_TEXT: HomeTextConfig = {
    enable: true,
    title: "",
    subtitle: [],
    typewriter: DEFAULT_TYPEWRITER,
};

/**
 * 规范化 banner.homeText 字段（标题、副标题、打字机配置）。
 */
export function normalizeBannerHomeText(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    const baseHomeText: HomeTextConfig =
        base.banner.homeText ?? DEFAULT_HOME_TEXT;
    const homeText: HomeTextConfig = merged.banner.homeText ?? baseHomeText;
    const subtitle = homeText.subtitle;
    const normalizedSubtitle = Array.isArray(subtitle)
        ? subtitle.map((item) => String(item || "").trim()).filter(Boolean)
        : typeof subtitle === "string"
          ? subtitle.trim()
          : baseHomeText.subtitle;
    const baseTypewriter: HomeTextTypewriter =
        baseHomeText.typewriter ?? DEFAULT_TYPEWRITER;
    const homeTypewriter: HomeTextTypewriter =
        homeText.typewriter ?? baseTypewriter;
    merged.banner.homeText = {
        enable: Boolean(homeText.enable),
        title: String(homeText.title ?? baseHomeText.title ?? "").trim(),
        subtitle: normalizedSubtitle,
        typewriter: normalizeHomeTextTypewriter(homeTypewriter, baseTypewriter),
    };
}

/**
 * 规范化 banner.homeText.typewriter 配置（speed、deleteSpeed、pauseTime）。
 */
function normalizeHomeTextTypewriter(
    homeTypewriter: HomeTextTypewriter,
    baseTypewriter: HomeTextTypewriter,
): HomeTextTypewriter {
    return {
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
    };
}

/**
 * 规范化 banner.navbar 字段。
 */
export function normalizeBannerNavbar(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    merged.banner.navbar = {
        transparentMode:
            merged.banner.navbar?.transparentMode === "semi" ||
            merged.banner.navbar?.transparentMode === "full" ||
            merged.banner.navbar?.transparentMode === "semifull"
                ? merged.banner.navbar.transparentMode
                : base.banner.navbar?.transparentMode || "semi",
    };
}

/**
 * 规范化 toc 字段（enable、mode、depth、useJapaneseBadge）。
 */
export function normalizeToc(merged: SiteSettingsPayload): void {
    merged.toc.enable = Boolean(merged.toc.enable);
    merged.toc.mode = merged.toc.mode === "float" ? "float" : "sidebar";
    merged.toc.depth = clampInteger(merged.toc.depth, 2, 1, 3) as 1 | 2 | 3;
    merged.toc.useJapaneseBadge = Boolean(merged.toc.useJapaneseBadge);
}

/**
 * 规范化 navBar.links 字段。
 */
export function normalizeNavBarLinks(merged: SiteSettingsPayload): void {
    const normalizedLinks = Array.isArray(merged.navBar.links)
        ? merged.navBar.links
              .map((link) => normalizeNavLink(link))
              .filter((entry): entry is NavLinkLike => Boolean(entry))
        : [];
    merged.navBar.links = normalizedLinks;
}

const SITE_PROFILE_AVATAR_PATH = "assets/images/avatar.webp";

/**
 * 规范化 profile 字段（avatar、name）。
 */
export function normalizeProfile(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    merged.profile.avatar = SITE_PROFILE_AVATAR_PATH;
    merged.profile.name =
        String(merged.profile.name || base.profile.name).trim() ||
        base.profile.name;
}

/**
 * 规范化 license 字段（enable、name、url）。
 */
export function normalizeLicense(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    merged.license.enable = Boolean(merged.license.enable);
    merged.license.name =
        String(merged.license.name || "").trim() || base.license.name;
    merged.license.url = isSafeNavigationUrl(String(merged.license.url || ""))
        ? String(merged.license.url || "").trim()
        : base.license.url;
}

/**
 * 规范化 announcement 字段（title、summary、body_markdown、closable）。
 */
export function normalizeAnnouncement(merged: SiteSettingsPayload): void {
    merged.announcement = {
        title: String(merged.announcement.title || "").trim(),
        summary: String(merged.announcement.summary || "").trim(),
        body_markdown: String(merged.announcement.body_markdown || "").trim(),
        closable: Boolean(merged.announcement.closable),
    };
}

/**
 * 规范化 musicPlayer 字段（enable、meting_api、id、server、type、marqueeSpeed）。
 */
export function normalizeMusicPlayer(merged: SiteSettingsPayload): void {
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
}

/**
 * 规范化 umami 字段（enabled、baseUrl、scripts）。
 */
export function normalizeUmami(merged: SiteSettingsPayload): void {
    merged.umami.enabled = Boolean(merged.umami.enabled);
    merged.umami.baseUrl = String(merged.umami.baseUrl || "").trim();
    merged.umami.scripts = String(merged.umami.scripts || "").trim();
}

/**
 * 规范化 analytics 字段（gtmId、clarityId）。
 */
export function normalizeAnalytics(
    merged: SiteSettingsPayload,
    base: SiteSettingsPayload,
): void {
    const baseAnalytics = base.analytics ?? { gtmId: "", clarityId: "" };
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
}

// ---- banner.src 辅助 ----

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

export function readRawBannerSrc(raw: unknown): unknown {
    if (!isRecord(raw)) {
        return undefined;
    }
    const banner = raw.banner;
    if (!isRecord(banner)) {
        return undefined;
    }
    return banner.src;
}
