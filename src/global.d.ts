import type { SiteConfig } from "./types/config";
import type { Translation } from "./i18n/translation";
import type { ResolvedSiteSettings } from "./types/site-settings";
import type { ProgressOverlayApi } from "./scripts/progress-overlay-manager";

export {};

type UmamiWebsiteStats = {
    pageviews?: number;
    visits?: number;
    visitors?: number;
    bounces?: number;
    totaltime?: number;
};

declare global {
    interface HTMLElementTagNameMap {
        "iconify-icon": HTMLElement;
        spoiler: HTMLElement;
        "table-of-contents": HTMLElement & {
            init?: () => void;
            regenerateTOC?: (retryCount?: number) => void;
        };
    }

    interface Window {
        closeAnnouncement: () => void;

        __bannerCarouselController?: {
            setPaused: (paused: boolean) => void;
        };
        __updateBannerCarouselState?: () => void;
        sakuraInitialized?: boolean;
        _calendarFilterListenerAttached?: boolean;

        panelManager?: typeof import("./utils/panel-manager").panelManager;

        getUmamiWebsiteStats?: (
            baseUrl: string,
            apiKey: string,
            websiteId: string,
        ) => Promise<UmamiWebsiteStats>;
        getUmamiPageStats?: (
            baseUrl: string,
            apiKey: string,
            websiteId: string,
            urlPath: string,
            startAt?: number,
            endAt?: number,
        ) => Promise<{ pageviews?: number; visitors?: number }>;
        clearUmamiShareCache?: () => void;

        floatingTOCInit?: () => void;
        iconifyLoaded?: boolean;
        __iconifyLoader?: {
            load: () => Promise<void>;
            addToPreloadQueue: (icons: string[]) => void;
            onLoad: (callback: () => void) => void;
            isLoaded: boolean;
        };
        __CIALLI_RUNTIME_SETTINGS__?: ResolvedSiteSettings;
        __CIALLI_I18N__?: Partial<Record<keyof Translation, string>>;
        __CIALLI_PROGRESS_OVERLAY__?: ProgressOverlayApi;
        __ppFromBase64Url?: (input: unknown) => Uint8Array;
        __ppSanitizeDecryptedHtml?: (rawHtml: unknown) => string;
        __ppResolveProtectedHtml?: (rawContent: unknown) => string;
        __ppDecryptPayloadV2?: (
            input: unknown,
            password: string,
        ) => Promise<string>;
        __ppDispatchPostDecryptTasks?: (
            contentBodyDiv: HTMLElement,
        ) => Promise<void>;
        siteConfig?: SiteConfig;
    }
}
