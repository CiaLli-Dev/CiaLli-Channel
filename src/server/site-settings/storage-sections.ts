import type {
    SiteSettingsPayload,
    StoredSiteSettingsNavSection,
    StoredSiteSettingsSectionFields,
} from "@/types/site-settings";
import { isRecord } from "@/server/site-settings/normalize-helpers";

export type StoredSiteSettingsSectionSources = {
    settings_site?: unknown;
    settings_nav?: unknown;
    settings_home?: unknown;
    settings_article?: unknown;
    settings_other?: unknown;
};

function recordOrEmpty(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

export function splitSiteSettingsForStorage(
    settings: SiteSettingsPayload,
): StoredSiteSettingsSectionFields {
    const { themePreset: _themePreset, ...storedSite } = settings.site;
    const { navbar: bannerNavbar, ...homeBanner } = settings.banner;
    const settingsNav: StoredSiteSettingsNavSection = {
        navbarTitle: settings.navbarTitle,
        navBar: settings.navBar,
        banner: {},
    };
    if (bannerNavbar) {
        settingsNav.banner.navbar = bannerNavbar;
    }

    return {
        settings_site: {
            site: storedSite,
            auth: settings.auth,
            profile: settings.profile,
        },
        settings_nav: settingsNav,
        settings_home: {
            wallpaperMode: settings.wallpaperMode,
            banner: homeBanner,
        },
        settings_article: {
            toc: settings.toc,
        },
        settings_other: {
            musicPlayer: settings.musicPlayer,
        },
    };
}

export function composeSiteSettingsFromStorageSections(
    source: StoredSiteSettingsSectionSources,
): Record<string, unknown> {
    const settingsSite = recordOrEmpty(source.settings_site);
    const settingsNav = recordOrEmpty(source.settings_nav);
    const settingsHome = recordOrEmpty(source.settings_home);
    const settingsArticle = recordOrEmpty(source.settings_article);
    const settingsOther = recordOrEmpty(source.settings_other);
    const homeBanner = recordOrEmpty(settingsHome.banner);
    const navBanner = recordOrEmpty(settingsNav.banner);
    const banner: Record<string, unknown> = { ...homeBanner };

    if (Object.prototype.hasOwnProperty.call(navBanner, "navbar")) {
        banner.navbar = navBanner.navbar;
    }

    return {
        ...settingsSite,
        navbarTitle: settingsNav.navbarTitle,
        navBar: settingsNav.navBar,
        wallpaperMode: settingsHome.wallpaperMode,
        banner,
        toc: settingsArticle.toc,
        musicPlayer: settingsOther.musicPlayer,
    };
}

export function isSectionedSiteSettingsEmpty(
    source: StoredSiteSettingsSectionSources,
): boolean {
    return (
        Object.keys(recordOrEmpty(source.settings_site)).length === 0 &&
        Object.keys(recordOrEmpty(source.settings_nav)).length === 0 &&
        Object.keys(recordOrEmpty(source.settings_home)).length === 0 &&
        Object.keys(recordOrEmpty(source.settings_article)).length === 0 &&
        Object.keys(recordOrEmpty(source.settings_other)).length === 0
    );
}
