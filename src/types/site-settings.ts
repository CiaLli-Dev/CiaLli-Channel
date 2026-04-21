import type { AppStatus } from "./app";
import type {
    AnnouncementConfig,
    BannerConfig,
    ExpressiveCodeConfig,
    Favicon,
    MusicPlayerConfig,
    NavBarConfig,
    NavbarTitleConfig,
    PageScalingConfig,
    SiteLanguage,
    SiteThemePreset,
    ThemeColorConfig,
    TocConfig,
    WallpaperModeConfig,
} from "./config";

export type ProfileRuntimeSettings = {
    avatar: string;
};

export type AiRuntimeSettings = {
    enabled: boolean;
    articleSummaryEnabled: boolean;
    baseUrl: string;
    model: string;
    apiKeyEncrypted: string | null;
    updatedAt: string | null;
};

export type EditableSiteSettings = {
    site: {
        title: string;
        subtitle: string;
        lang: "en" | "zh_CN" | "zh_TW" | "ja";
        timeZone: string | null;
        themePreset: SiteThemePreset;
        keywords: string[];
        siteStartDate: string | null;
        favicon: Favicon[];
    };
    auth: {
        register_enabled: boolean;
    };
    navbarTitle: NavbarTitleConfig;
    wallpaperMode: WallpaperModeConfig;
    banner: BannerConfig;
    toc: TocConfig;
    navBar: NavBarConfig;
    profile: ProfileRuntimeSettings;
    announcement: AnnouncementConfig;
    musicPlayer: MusicPlayerConfig;
    ai: AiRuntimeSettings;
};

export type SiteSettingsPayload = EditableSiteSettings;

export type StoredSiteSettingsSiteSection = {
    site: Omit<SiteSettingsPayload["site"], "themePreset">;
    auth: SiteSettingsPayload["auth"];
    profile: SiteSettingsPayload["profile"];
};

export type StoredSiteSettingsNavSection = {
    navbarTitle: SiteSettingsPayload["navbarTitle"];
    navBar: SiteSettingsPayload["navBar"];
    banner: Pick<SiteSettingsPayload["banner"], "navbar">;
};

export type StoredSiteSettingsHomeSection = {
    wallpaperMode: SiteSettingsPayload["wallpaperMode"];
    banner: Omit<SiteSettingsPayload["banner"], "navbar">;
};

export type StoredSiteSettingsArticleSection = {
    toc: SiteSettingsPayload["toc"];
};

export type StoredSiteSettingsOtherSection = {
    musicPlayer: SiteSettingsPayload["musicPlayer"];
    ai: SiteSettingsPayload["ai"];
};

export type StoredSiteSettingsSectionFields = {
    settings_site: StoredSiteSettingsSiteSection;
    settings_nav: StoredSiteSettingsNavSection;
    settings_home: StoredSiteSettingsHomeSection;
    settings_article: StoredSiteSettingsArticleSection;
    settings_other: StoredSiteSettingsOtherSection;
};

export type SiteAnnouncementPayload = {
    key: string;
    title: string;
    summary: string;
    body_markdown: string;
    closable: boolean;
};

export type PublicSiteSettings = EditableSiteSettings;

export type SystemSiteConfig = {
    siteURL: string;
    lang: SiteLanguage;
    timeZone: string;
    themeColor: ThemeColorConfig;
    pageScaling: PageScalingConfig;
    expressiveCode: ExpressiveCodeConfig;
};

export type ResolvedSiteSettings = {
    system: SystemSiteConfig;
    settings: SiteSettingsPayload;
};

export type AppSiteSettings = {
    id: string;
    key: string;
    settings_site: StoredSiteSettingsSiteSection | null;
    settings_nav: StoredSiteSettingsNavSection | null;
    settings_home: StoredSiteSettingsHomeSection | null;
    settings_article: StoredSiteSettingsArticleSection | null;
    settings_other: StoredSiteSettingsOtherSection | null;
    theme_preset: SiteThemePreset;
    status: AppStatus;
    sort: number | null;
    user_created: string | null;
    date_created: string | null;
    user_updated: string | null;
    date_updated: string | null;
};

export type AppSiteAnnouncement = {
    id: string;
    key: string;
    title: string;
    summary: string;
    body_markdown: string;
    closable: boolean;
    status: AppStatus;
    sort: number | null;
    user_created: string | null;
    date_created: string | null;
    user_updated: string | null;
    date_updated: string | null;
};
