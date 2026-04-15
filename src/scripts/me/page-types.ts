/**
 * /me/ 账户设置页：共享类型、常量与接口。
 */

export const AUTH_ME_RETRY_DELAY_MS = 220;
export const AVATAR_CROP_OUTPUT_SIZE = 512;
export const AVATAR_CROP_ZOOM_MIN = 100;
export const AVATAR_CROP_ZOOM_MAX = 300;
export const EMPTY_AVATAR_SRC =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%23d1d5db'/%3E%3C/svg%3E";
export const DATA_BOUND = "data-me-bound";
export const OUTSIDE_CLICK_KEY = "__cialli_me_page_outside_click__";

export const SOCIAL_PLATFORMS = [
    "github",
    "twitter",
    "bilibili",
    "discord",
    "youtube",
    "mastodon",
    "telegram",
    "steam",
    "email",
    "website",
    "gitee",
    "codeberg",
] as const;

export const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
    github: "GitHub",
    twitter: "Twitter",
    bilibili: "Bilibili",
    discord: "Discord",
    youtube: "YouTube",
    mastodon: "Mastodon",
    telegram: "Telegram",
    steam: "Steam",
    email: "Email",
    website: "Website",
    gitee: "Gitee",
    codeberg: "Codeberg",
};

export const PRIVACY_CHECKBOX_IDS: [string, string][] = [
    ["pv-profile-public", "profile_public"],
    ["pv-show-articles", "show_articles"],
    ["pv-show-diaries", "show_diaries"],
    ["pv-show-albums", "show_albums"],
    ["pv-show-comments", "show_comments"],
];

export interface ProfileSnapshot {
    username: string;
    display_name: string;
    bio: string;
    avatar_file_id: string;
    avatar_pending_upload: boolean;
}

export interface PrivacySnapshot {
    profile_public: boolean;
    show_articles: boolean;
    show_diaries: boolean;
    show_albums: boolean;
    show_comments: boolean;
}

export interface SocialLink {
    platform: string;
    url: string;
    enabled: boolean;
}

export interface RuntimeWindow extends Window {
    [OUTSIDE_CLICK_KEY]?: ((e: MouseEvent) => void) | undefined;
}

export interface MePageState {
    currentLoginEmail: string;
    currentAvatarFileId: string;
    currentAvatarFallbackUrl: string;
    pendingAvatarUpload: { blob: Blob; previewUrl: string } | null;
    avatarCropObjectUrl: string;
    avatarCropLoaded: boolean;
    avatarCropImageWidth: number;
    avatarCropImageHeight: number;
    avatarCropViewportSize: number;
    avatarCropMinScale: number;
    avatarCropScale: number;
    avatarCropOffsetX: number;
    avatarCropOffsetY: number;
    avatarCropPointerId: number | null;
    avatarCropPointerX: number;
    avatarCropPointerY: number;
    avatarUploading: boolean;
    profileSnapshot: ProfileSnapshot | null;
    privacySnapshot: PrivacySnapshot | null;
}

export interface MePageDom {
    authenticatedSections: HTMLElement;
    profileMsg: HTMLElement | null;
    privacyMsg: HTMLElement | null;
    logoutBtn: HTMLButtonElement | null;
    emailInput: HTMLInputElement | null;
    usernameDisplayBtn: HTMLButtonElement | null;
    usernameDisplayText: HTMLElement | null;
    usernameEditor: HTMLElement | null;
    usernameInput: HTMLInputElement | null;
    usernameCounter: HTMLElement | null;
    bioDisplayBtn: HTMLButtonElement | null;
    bioDisplayText: HTMLElement | null;
    bioEditor: HTMLElement | null;
    bioInput: HTMLTextAreaElement | null;
    bioCounter: HTMLElement | null;
    displaynameDisplayBtn: HTMLButtonElement | null;
    displaynameDisplayText: HTMLElement | null;
    displaynameEditor: HTMLElement | null;
    displaynameInput: HTMLInputElement | null;
    displaynameCounter: HTMLElement | null;
    socialLinksList: HTMLElement | null;
    socialSaveBtn: HTMLElement | null;
    socialMsg: HTMLElement | null;
    avatarPreviewEl: HTMLImageElement | null;
    avatarUploadBtn: HTMLElement | null;
    avatarClearBtn: HTMLElement | null;
    avatarCropModal: HTMLElement | null;
    avatarCropViewport: HTMLElement | null;
    avatarCropImage: HTMLImageElement | null;
    avatarCropEmpty: HTMLElement | null;
    avatarCropFileInput: HTMLInputElement | null;
    avatarCropSelectBtn: HTMLElement | null;
    avatarCropApplyBtn: HTMLButtonElement | null;
    avatarCropCancelBtn: HTMLElement | null;
    avatarCropZoomInput: HTMLInputElement | null;
    avatarCropMsg: HTMLElement | null;
}

export function createInitialState(): MePageState {
    return {
        currentLoginEmail: "",
        currentAvatarFileId: "",
        currentAvatarFallbackUrl: "",
        pendingAvatarUpload: null,
        avatarCropObjectUrl: "",
        avatarCropLoaded: false,
        avatarCropImageWidth: 0,
        avatarCropImageHeight: 0,
        avatarCropViewportSize: 0,
        avatarCropMinScale: 1,
        avatarCropScale: 1,
        avatarCropOffsetX: 0,
        avatarCropOffsetY: 0,
        avatarCropPointerId: null,
        avatarCropPointerX: 0,
        avatarCropPointerY: 0,
        avatarUploading: false,
        profileSnapshot: null,
        privacySnapshot: null,
    };
}
