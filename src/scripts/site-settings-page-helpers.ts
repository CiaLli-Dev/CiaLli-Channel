/**
 * site-settings-page 的设置绑定与收集模块。
 *
 * 包含 bindSettings（及各分区子函数）与 collectXxxPayload 系列函数。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import { SITE_TIME_ZONE_AUTO_VALUE } from "@/utils/date-utils";
import {
    inputVal,
    textareaVal,
    checked,
    setVal,
    setChecked,
    setSelect,
    numberOrFallback,
} from "@/scripts/dom-helpers";
import type { FaviconItem } from "@/scripts/site-settings-page-editor";
import {
    faviconListContainer,
    bannerDesktopListContainer,
    bannerDesktopDragSource,
    fillFaviconList,
    fillBannerList,
    collectFaviconList,
    collectBannerList,
    normalizeBannerEditorList,
} from "@/scripts/site-settings-page-editor";
import type { NavLinkItem } from "@/scripts/site-settings-page-nav";
import {
    navLinksContainer,
    fillNavLinks,
    collectNavLinks,
} from "@/scripts/site-settings-page-nav";

export type SettingsObj = Record<string, unknown>;

// ---------------------------------------------------------------------------
// bindSettings — 按分区拆分为独立函数
// ---------------------------------------------------------------------------

function bindSiteBasicFields(site: SettingsObj, profile: SettingsObj): void {
    setVal("ss-title", String(site.title ?? ""));
    setVal("ss-subtitle", String(site.subtitle ?? ""));
    setSelect("ss-language", String(site.lang ?? "zh_CN"));
    setSelect(
        "ss-timezone",
        typeof site.timeZone === "string" && site.timeZone.trim()
            ? String(site.timeZone)
            : SITE_TIME_ZONE_AUTO_VALUE,
    );
    setVal(
        "ss-keywords",
        Array.isArray(site.keywords)
            ? (site.keywords as string[]).join(", ")
            : "",
    );
    setVal("ss-start-date", String(site.siteStartDate ?? ""));
    setVal("ss-profile-name", String(profile.name ?? ""));
}

function bindSiteAnalyticsFields(
    umami: SettingsObj,
    analytics: SettingsObj,
): void {
    setChecked("ss-umami-enabled", Boolean(umami.enabled));
    setVal("ss-umami-url", String(umami.baseUrl ?? ""));
    setVal("ss-umami-scripts", String(umami.scripts ?? ""));
    setVal("ss-gtm-id", String(analytics.gtmId ?? ""));
    setVal("ss-clarity-id", String(analytics.clarityId ?? ""));
}

function bindSiteSection(s: SettingsObj): void {
    const site = (s.site ?? {}) as SettingsObj;
    const profile = (s.profile ?? {}) as SettingsObj;
    const umami = (s.umami ?? {}) as SettingsObj;
    const analytics = (s.analytics ?? {}) as SettingsObj;

    bindSiteBasicFields(site, profile);
    bindSiteAnalyticsFields(umami, analytics);

    if (faviconListContainer) {
        fillFaviconList(
            Array.isArray(site.favicon) ? (site.favicon as FaviconItem[]) : [],
            faviconListContainer,
        );
    }
}

function bindNavSection(s: SettingsObj): void {
    const navbarTitle = (s.navbarTitle ?? {}) as SettingsObj;
    const banner = (s.banner ?? {}) as SettingsObj;
    const bannerNavbar = (banner.navbar ?? {}) as SettingsObj;
    const navBar = (s.navBar ?? {}) as SettingsObj;

    setSelect("ss-navbar-mode", String(navbarTitle.mode ?? "logo"));
    setVal("ss-navbar-text", String(navbarTitle.text ?? ""));
    setVal("ss-navbar-icon", String(navbarTitle.icon ?? ""));
    setVal("ss-navbar-logo", String(navbarTitle.logo ?? ""));
    setSelect(
        "ss-navbar-transparent-mode",
        String(bannerNavbar.transparentMode ?? "semi"),
    );
    if (navLinksContainer) {
        fillNavLinks((navBar.links ?? []) as NavLinkItem[], navLinksContainer);
    }
}

function bindTypewriterFields(bannerHomeTypewriter: SettingsObj): void {
    setChecked(
        "ss-banner-home-typewriter-enable",
        Boolean(bannerHomeTypewriter.enable),
    );
    setVal(
        "ss-banner-home-typewriter-speed",
        String(bannerHomeTypewriter.speed ?? ""),
    );
    setVal(
        "ss-banner-home-typewriter-delete-speed",
        String(bannerHomeTypewriter.deleteSpeed ?? ""),
    );
    setVal(
        "ss-banner-home-typewriter-pause-time",
        String(bannerHomeTypewriter.pauseTime ?? ""),
    );
}

function bindBannerCarouselAndImageApi(
    bannerCarousel: SettingsObj,
    bannerImageApi: SettingsObj,
): void {
    setChecked(
        "ss-banner-carousel-enable",
        Boolean(bannerCarousel.enable ?? false),
    );
    setVal(
        "ss-banner-carousel-interval",
        String(bannerCarousel.interval ?? ""),
    );
    setChecked("ss-banner-image-api-enable", Boolean(bannerImageApi.enable));
    setVal("ss-banner-image-api-url", String(bannerImageApi.url ?? ""));
}

function bindBannerHomeTextField(bannerHomeText: SettingsObj): void {
    setChecked("ss-banner-home-text-enable", Boolean(bannerHomeText.enable));
    setVal("ss-banner-home-text-title", String(bannerHomeText.title ?? ""));
    const homeSubtitle = bannerHomeText.subtitle;
    const subtitleStr = String(homeSubtitle ?? "").trim();
    const subtitleLines = Array.isArray(homeSubtitle)
        ? homeSubtitle.map((item) => String(item || "").trim()).filter(Boolean)
        : subtitleStr
          ? [subtitleStr]
          : [];
    setVal("ss-banner-home-text-subtitle", subtitleLines.join("\n"));
}

function bindHomeSection(s: SettingsObj): void {
    const wallpaperMode = (s.wallpaperMode ?? {}) as SettingsObj;
    const banner = (s.banner ?? {}) as SettingsObj;
    const bannerCarousel = (banner.carousel ?? {}) as SettingsObj;
    const bannerWaves = (banner.waves ?? {}) as SettingsObj;
    const bannerImageApi = (banner.imageApi ?? {}) as SettingsObj;
    const bannerHomeText = (banner.homeText ?? {}) as SettingsObj;
    const bannerHomeTypewriter = (bannerHomeText.typewriter ??
        {}) as SettingsObj;

    setSelect(
        "ss-wallpaper-mode",
        String(wallpaperMode.defaultMode ?? "banner"),
    );
    setSelect("ss-banner-position", String(banner.position ?? "center"));

    bindBannerCarouselAndImageApi(bannerCarousel, bannerImageApi);
    bindBannerHomeTextField(bannerHomeText);
    bindTypewriterFields(bannerHomeTypewriter);

    setChecked("ss-banner-waves-enable", Boolean(bannerWaves.enable));
    setChecked(
        "ss-banner-waves-performance",
        Boolean(bannerWaves.performanceMode),
    );

    const bannerDesktopList = normalizeBannerEditorList(banner.src);
    if (bannerDesktopListContainer) {
        fillBannerList(
            bannerDesktopList,
            bannerDesktopListContainer,
            () => bannerDesktopDragSource,
            (e) => {
                void e;
            },
        );
    }
}

function bindOtherSection(s: SettingsObj): void {
    const musicPlayer = (s.musicPlayer ?? {}) as SettingsObj;
    const sakura = (s.sakura ?? {}) as SettingsObj;

    setChecked("ss-music-enable", Boolean(musicPlayer.enable));
    setVal("ss-music-api", String(musicPlayer.meting_api ?? ""));
    setVal("ss-music-id", String(musicPlayer.id ?? ""));
    setVal("ss-music-server", String(musicPlayer.server ?? ""));
    setVal("ss-music-type", String(musicPlayer.type ?? ""));
    setVal("ss-music-marquee", String(musicPlayer.marqueeSpeed ?? ""));
    setChecked("ss-sakura-enable", Boolean(sakura.enable));
}

function bindFeatureSection(s: SettingsObj): void {
    const toc = (s.toc ?? {}) as SettingsObj;
    const license = (s.license ?? {}) as SettingsObj;

    setChecked("ss-toc-enable", Boolean(toc.enable));
    setChecked("ss-toc-jp", Boolean(toc.useJapaneseBadge));
    setSelect("ss-toc-mode", String(toc.mode ?? "sidebar"));
    setSelect("ss-toc-depth", String(toc.depth ?? 2));
    setChecked("ss-license-enable", Boolean(license.enable));
    setVal("ss-license-name", String(license.name ?? ""));
    setVal("ss-license-url", String(license.url ?? ""));
}

export function bindSettings(s: SettingsObj): void {
    bindSiteSection(s);
    bindNavSection(s);
    bindHomeSection(s);
    bindOtherSection(s);
    bindFeatureSection(s);
}

// ---------------------------------------------------------------------------
// 请求载荷收集
// ---------------------------------------------------------------------------

export function collectSitePayload(current: SettingsObj): SettingsObj {
    return {
        site: {
            ...((current.site ?? {}) as SettingsObj),
            title: inputVal("ss-title"),
            subtitle: inputVal("ss-subtitle"),
            lang: inputVal("ss-language") || "zh_CN",
            timeZone:
                inputVal("ss-timezone") === SITE_TIME_ZONE_AUTO_VALUE
                    ? null
                    : inputVal("ss-timezone") || null,
            keywords: inputVal("ss-keywords")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            siteStartDate: inputVal("ss-start-date") || null,
            favicon: faviconListContainer
                ? collectFaviconList(faviconListContainer)
                : ((current.site as SettingsObj | undefined)?.favicon ?? []),
        },
        profile: {
            ...((current.profile ?? {}) as SettingsObj),
            name: inputVal("ss-profile-name"),
        },
        umami: {
            enabled: checked("ss-umami-enabled"),
            baseUrl: inputVal("ss-umami-url"),
            scripts: textareaVal("ss-umami-scripts"),
        },
        analytics: {
            ...((current.analytics ?? {}) as SettingsObj),
            gtmId: inputVal("ss-gtm-id"),
            clarityId: inputVal("ss-clarity-id"),
        },
    };
}

export function collectNavPayload(current: SettingsObj): SettingsObj {
    const currentBanner = (current.banner ?? {}) as SettingsObj;
    const currentBannerNavbar = (currentBanner.navbar ?? {}) as SettingsObj;
    return {
        navbarTitle: {
            ...((current.navbarTitle ?? {}) as SettingsObj),
            mode: inputVal("ss-navbar-mode") || "logo",
            text: inputVal("ss-navbar-text"),
            icon: inputVal("ss-navbar-icon"),
            logo: inputVal("ss-navbar-logo"),
        },
        banner: {
            ...currentBanner,
            navbar: {
                ...currentBannerNavbar,
                transparentMode:
                    inputVal("ss-navbar-transparent-mode") || "semi",
            },
        },
        navBar: {
            links: navLinksContainer
                ? collectNavLinks(navLinksContainer)
                : ((current.navBar as SettingsObj | undefined)?.links ?? []),
        },
    };
}

function collectBannerHomeText(
    currentBannerHomeText: SettingsObj,
    currentBannerTypewriter: SettingsObj,
): SettingsObj {
    return {
        ...currentBannerHomeText,
        enable: checked("ss-banner-home-text-enable"),
        title: inputVal("ss-banner-home-text-title"),
        subtitle: textareaVal("ss-banner-home-text-subtitle")
            .split(/\r?\n/u)
            .map((item) => item.trim())
            .filter(Boolean),
        typewriter: {
            ...currentBannerTypewriter,
            enable: checked("ss-banner-home-typewriter-enable"),
            speed: numberOrFallback(
                inputVal("ss-banner-home-typewriter-speed"),
                100,
            ),
            deleteSpeed: numberOrFallback(
                inputVal("ss-banner-home-typewriter-delete-speed"),
                50,
            ),
            pauseTime: numberOrFallback(
                inputVal("ss-banner-home-typewriter-pause-time"),
                2000,
            ),
        },
    };
}

function collectBannerPayload(currentBanner: SettingsObj): SettingsObj {
    const currentBannerCarousel = (currentBanner.carousel ?? {}) as SettingsObj;
    const currentBannerImageApi = (currentBanner.imageApi ?? {}) as SettingsObj;
    const currentBannerHomeText = (currentBanner.homeText ?? {}) as SettingsObj;
    const currentBannerTypewriter = (currentBannerHomeText.typewriter ??
        {}) as SettingsObj;
    const currentBannerWaves = (currentBanner.waves ?? {}) as SettingsObj;

    const intervalInput = Number(inputVal("ss-banner-carousel-interval") || 0);
    const intervalFallback = Number(currentBannerCarousel.interval ?? 5);

    return {
        ...currentBanner,
        position: inputVal("ss-banner-position") || "center",
        src: bannerDesktopListContainer
            ? collectBannerList(bannerDesktopListContainer)
            : [],
        carousel: {
            ...currentBannerCarousel,
            enable: checked("ss-banner-carousel-enable"),
            interval: intervalInput || intervalFallback,
        },
        imageApi: {
            ...currentBannerImageApi,
            enable: checked("ss-banner-image-api-enable"),
            url: inputVal("ss-banner-image-api-url"),
        },
        homeText: collectBannerHomeText(
            currentBannerHomeText,
            currentBannerTypewriter,
        ),
        waves: {
            ...currentBannerWaves,
            enable: checked("ss-banner-waves-enable"),
            performanceMode: checked("ss-banner-waves-performance"),
        },
    };
}

export function collectHomePayload(current: SettingsObj): SettingsObj {
    const currentBanner = (current.banner ?? {}) as SettingsObj;
    return {
        wallpaperMode: {
            ...((current.wallpaperMode ?? {}) as SettingsObj),
            defaultMode: inputVal("ss-wallpaper-mode") || "banner",
        },
        banner: collectBannerPayload(currentBanner),
    };
}

export function collectOtherPayload(current: SettingsObj): SettingsObj {
    return {
        musicPlayer: {
            ...((current.musicPlayer ?? {}) as SettingsObj),
            enable: checked("ss-music-enable"),
            meting_api: inputVal("ss-music-api"),
            id: inputVal("ss-music-id"),
            server: inputVal("ss-music-server"),
            type: inputVal("ss-music-type"),
            marqueeSpeed: numberOrFallback(inputVal("ss-music-marquee"), 10),
        },
        sakura: {
            enable: checked("ss-sakura-enable"),
        },
    };
}

export function collectFeaturePayload(current: SettingsObj): SettingsObj {
    return {
        toc: {
            enable: checked("ss-toc-enable"),
            useJapaneseBadge: checked("ss-toc-jp"),
            mode: inputVal("ss-toc-mode") || "sidebar",
            depth: Number(inputVal("ss-toc-depth") || 2),
        },
        license: {
            ...((current.license ?? {}) as SettingsObj),
            enable: checked("ss-license-enable"),
            name: inputVal("ss-license-name"),
            url: inputVal("ss-license-url"),
        },
    };
}

// 导出 i18n 消息 key，供主文件使用（避免主文件再导入 I18nKey）
export const MSG_KEYS = {
    iconRemovedPendingSave: I18nKey.adminSiteSettingsIconRemovedPendingSave,
    bannerRemovedPendingSave: I18nKey.adminSiteSettingsBannerRemovedPendingSave,
    savingTitle: I18nKey.adminSiteSettingsSavingTitle,
    savingConfig: I18nKey.adminSiteSettingsSavingConfig,
    uploadFailedCanceled: I18nKey.adminSiteSettingsUploadFailedCanceled,
    invalidInput: I18nKey.adminSiteSettingsInvalidInput,
    iconAddedPendingSave: I18nKey.adminSiteSettingsIconAddedPendingSave,
} as const;

export { t };
