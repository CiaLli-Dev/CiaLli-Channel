import type { AppStatus } from "./app";
import type {
    AnnouncementConfig,
    ExpressiveCodeConfig,
    Favicon,
    MusicPlayerConfig,
    NavBarConfig,
    SiteConfig,
} from "./config";

export type ProfileRuntimeSettings = {
    avatar: string;
};

export type EditableSiteSettings = {
    site: {
        title: string;
        subtitle: string;
        lang: "en" | "zh_CN" | "zh_TW" | "ja";
        timeZone: string | null;
        keywords: string[];
        siteStartDate: string | null;
        favicon: Favicon[];
    };
    auth: {
        register_enabled: boolean;
    };
    navbarTitle: NonNullable<SiteConfig["navbarTitle"]>;
    wallpaperMode: SiteConfig["wallpaperMode"];
    banner: SiteConfig["banner"];
    toc: SiteConfig["toc"];
    navBar: NavBarConfig;
    profile: ProfileRuntimeSettings;
    announcement: AnnouncementConfig;
    musicPlayer: MusicPlayerConfig;
};

export type SiteSettingsPayload = EditableSiteSettings;

export type StoredSiteSettingsPayload = Omit<
    SiteSettingsPayload,
    "announcement"
>;

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
    lang: SiteConfig["lang"];
    timeZone: string;
    themeColor: SiteConfig["themeColor"];
    pageScaling: NonNullable<SiteConfig["pageScaling"]>;
    expressiveCode: ExpressiveCodeConfig;
};

export type ResolvedSiteSettings = {
    system: SystemSiteConfig;
    settings: SiteSettingsPayload;
};

export type AppSiteSettings = {
    id: string;
    key: string;
    settings: StoredSiteSettingsPayload | null;
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
