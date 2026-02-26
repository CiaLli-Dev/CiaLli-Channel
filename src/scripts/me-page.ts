/**
 * /me/ 账户设置页运行逻辑。
 *
 * 从页面内联脚本抽离为模块，确保页面导航后可重新初始化，
 * 避免依赖整页刷新。
 */

// ---------------------------------------------------------------------------
// 模块级工具函数（不依赖 DOM）
// ---------------------------------------------------------------------------

import I18nKey from "@/i18n/i18nKey";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    runWithTask,
    updateTask,
    type ProgressTaskHandle,
} from "@/scripts/progress-overlay-manager";
import {
    getApiErrorMessage,
    requestApi as api,
    type ApiResult,
} from "@/scripts/http-client";
import {
    weightedCharLength,
    USERNAME_MAX_WEIGHT,
    DISPLAY_NAME_MAX_WEIGHT,
    PROFILE_BIO_MAX_LENGTH,
} from "@/constants/text-limits";

const OUTSIDE_CLICK_KEY = "__cialli_me_page_outside_click__";

interface RuntimeWindow extends Window {
    [OUTSIDE_CLICK_KEY]?: ((e: MouseEvent) => void) | undefined;
}
const runtimeWindow = window as RuntimeWindow;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const buildAssetUrl = (fileId: string): string => {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return "";
    }
    return `/api/v1/public/assets/${encodeURIComponent(normalized)}`;
};

const buildLoginRedirectHref = (): string => {
    const pathname = String(window.location.pathname || "/");
    const search = String(window.location.search || "");
    const hash = String(window.location.hash || "");
    const redirect = `${pathname}${search}${hash}` || "/";
    if (!redirect.startsWith("/") || redirect.startsWith("//")) {
        return "/auth/login";
    }
    return `/auth/login?redirect=${encodeURIComponent(redirect)}`;
};

const extractFileId = (value: unknown): string => {
    if (!value) {
        return "";
    }
    if (typeof value === "string") {
        return value.trim();
    }
    if (
        typeof value === "object" &&
        "id" in value &&
        typeof (value as { id: unknown }).id === "string"
    ) {
        return String((value as { id: string }).id || "").trim();
    }
    return "";
};

const AUTH_ME_RETRY_DELAY_MS = 220;
const PROFILE_BIO_TYPEWRITER_SPEED_MIN = 10;
const PROFILE_BIO_TYPEWRITER_SPEED_MAX = 500;
const AVATAR_CROP_OUTPUT_SIZE = 512;
const AVATAR_CROP_ZOOM_MIN = 100;
const AVATAR_CROP_ZOOM_MAX = 300;

const EMPTY_AVATAR_SRC =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' fill='%23d1d5db'/%3E%3C/svg%3E";

const DATA_BOUND = "data-me-bound";

// ---------------------------------------------------------------------------
// initMePage：首屏加载与每次 astro:after-swap 后均会调用
// ---------------------------------------------------------------------------

export function initMePage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/me") {
        return;
    }

    // 每次初始化都重新获取 DOM，避免页面切换后引用失效
    const authenticatedSections = document.getElementById(
        "me-authenticated-sections",
    );
    const profileMsg = document.getElementById("me-profile-msg");
    const privacyMsg = document.getElementById("me-privacy-msg");
    const emailInput = document.getElementById(
        "me-email",
    ) as HTMLInputElement | null;
    const usernameDisplayBtn = document.getElementById(
        "me-username-display-btn",
    ) as HTMLButtonElement | null;
    const usernameDisplayText = document.getElementById("me-username-display");
    const usernameEditor = document.getElementById("me-username-editor");
    const usernameInput = document.getElementById(
        "me-username",
    ) as HTMLInputElement | null;
    const usernameCounter = document.getElementById("me-username-counter");
    const bioDisplayBtn = document.getElementById(
        "me-bio-display-btn",
    ) as HTMLButtonElement | null;
    const bioDisplayText = document.getElementById("me-bio-display");
    const bioEditor = document.getElementById("me-bio-editor");
    const bioInput = document.getElementById(
        "me-bio",
    ) as HTMLTextAreaElement | null;
    const bioCounter = document.getElementById("me-bio-counter");
    const bioTypewriterEnableInput = document.getElementById(
        "me-bio-typewriter-enable",
    ) as HTMLInputElement | null;
    const bioTypewriterSpeedInput = document.getElementById(
        "me-bio-typewriter-speed",
    ) as HTMLInputElement | null;
    const displaynameDisplayBtn = document.getElementById(
        "me-displayname-display-btn",
    ) as HTMLButtonElement | null;
    const displaynameDisplayText = document.getElementById(
        "me-displayname-display",
    );
    const displaynameEditor = document.getElementById("me-displayname-editor");
    const displaynameInput = document.getElementById(
        "me-displayname",
    ) as HTMLInputElement | null;
    const displaynameCounter = document.getElementById(
        "me-displayname-counter",
    );
    const socialLinksList = document.getElementById("me-social-links-list");
    const socialSaveBtn = document.getElementById("me-social-save-btn");
    const socialMsg = document.getElementById("me-social-msg");
    const avatarPreviewEl = document.getElementById(
        "me-avatar-preview",
    ) as HTMLImageElement | null;
    const avatarUrlInput = document.getElementById(
        "me-avatar-url",
    ) as HTMLInputElement | null;
    const avatarUploadBtn = document.getElementById("me-avatar-upload-btn");
    const avatarClearBtn = document.getElementById("me-avatar-clear-btn");
    const avatarCropModal = document.getElementById("me-avatar-crop-modal");
    const avatarCropViewport = document.getElementById(
        "me-avatar-crop-viewport",
    ) as HTMLElement | null;
    const avatarCropImage = document.getElementById(
        "me-avatar-crop-image",
    ) as HTMLImageElement | null;
    const avatarCropEmpty = document.getElementById("me-avatar-crop-empty");
    const avatarCropFileInput = document.getElementById(
        "me-avatar-crop-file",
    ) as HTMLInputElement | null;
    const avatarCropSelectBtn = document.getElementById(
        "me-avatar-crop-select-btn",
    );
    const avatarCropApplyBtn = document.getElementById(
        "me-avatar-crop-apply-btn",
    ) as HTMLButtonElement | null;
    const avatarCropCancelBtn = document.getElementById(
        "me-avatar-crop-cancel-btn",
    );
    const avatarCropZoomInput = document.getElementById(
        "me-avatar-crop-zoom",
    ) as HTMLInputElement | null;
    const avatarCropMsg = document.getElementById("me-avatar-crop-msg");

    if (!authenticatedSections) {
        return;
    }

    // ---- dirty-state tracking ----
    interface ProfileSnapshot {
        username: string;
        display_name: string;
        bio: string;
        bio_typewriter_enable: boolean;
        bio_typewriter_speed: number;
        avatar_url: string;
        avatar_file_id: string;
        avatar_pending_upload: boolean;
    }

    interface PrivacySnapshot {
        profile_public: boolean;
        show_articles: boolean;
        show_diaries: boolean;
        show_albums: boolean;
        show_comments: boolean;
    }

    let profileSnapshot: ProfileSnapshot | null = null;
    let privacySnapshot: PrivacySnapshot | null = null;

    const PRIVACY_CHECKBOX_IDS: [string, keyof PrivacySnapshot][] = [
        ["pv-profile-public", "profile_public"],
        ["pv-show-articles", "show_articles"],
        ["pv-show-diaries", "show_diaries"],
        ["pv-show-albums", "show_albums"],
        ["pv-show-comments", "show_comments"],
    ];

    const PRIVACY_LABELS: Record<string, string> = {
        profile_public: t(I18nKey.meSettingsPrivacyProfilePublic),
        show_articles: t(I18nKey.meSettingsPrivacyShowArticles),
        show_diaries: t(I18nKey.meSettingsPrivacyShowDiaries),
        show_albums: t(I18nKey.meSettingsPrivacyShowAlbums),
        show_comments: t(I18nKey.meSettingsPrivacyShowComments),
    };

    const captureProfileSnapshot = (): ProfileSnapshot => ({
        username: usernameInput ? String(usernameInput.value || "").trim() : "",
        display_name: displaynameInput
            ? String(displaynameInput.value || "").trim()
            : "",
        bio: bioInput ? String(bioInput.value || "") : "",
        bio_typewriter_enable: bioTypewriterEnableInput?.checked ?? true,
        bio_typewriter_speed: Math.max(
            PROFILE_BIO_TYPEWRITER_SPEED_MIN,
            Math.min(
                PROFILE_BIO_TYPEWRITER_SPEED_MAX,
                Math.floor(Number(bioTypewriterSpeedInput?.value || 80) || 80),
            ),
        ),
        avatar_url: avatarUrlInput
            ? String(avatarUrlInput.value || "").trim()
            : "",
        avatar_file_id: currentAvatarFileId,
        avatar_pending_upload: Boolean(pendingAvatarUpload),
    });

    const capturePrivacySnapshot = (): PrivacySnapshot => {
        const snap: Record<string, boolean> = {};
        for (const [elId, key] of PRIVACY_CHECKBOX_IDS) {
            const el = document.getElementById(elId) as HTMLInputElement | null;
            snap[key] = el?.checked ?? false;
        }
        return snap as unknown as PrivacySnapshot;
    };

    const checkProfileDirty = (): void => {
        if (!profileSnapshot || !profileMsg) {
            return;
        }
        const current = captureProfileSnapshot();
        const changed: string[] = [];
        if (current.username !== profileSnapshot.username) {
            changed.push(t(I18nKey.meSettingsUsernameLabel));
        }
        if (current.display_name !== profileSnapshot.display_name) {
            changed.push(t(I18nKey.meSettingsDisplayNameLabel));
        }
        if (current.bio !== profileSnapshot.bio) {
            changed.push(t(I18nKey.meSettingsBioLabel));
        }
        if (
            current.bio_typewriter_enable !==
                profileSnapshot.bio_typewriter_enable ||
            current.bio_typewriter_speed !==
                profileSnapshot.bio_typewriter_speed
        ) {
            changed.push(t(I18nKey.meSettingsBioTypewriter));
        }
        if (
            current.avatar_url !== profileSnapshot.avatar_url ||
            current.avatar_file_id !== profileSnapshot.avatar_file_id ||
            current.avatar_pending_upload !==
                profileSnapshot.avatar_pending_upload
        ) {
            changed.push(t(I18nKey.meSettingsAvatarLabel));
        }
        if (changed.length > 0) {
            profileMsg.textContent = tFmt(
                I18nKey.meSettingsProfileDirtyNotice,
                {
                    fields: changed.join("、"),
                },
            );
        } else {
            profileMsg.textContent = "";
        }
    };

    const checkPrivacyDirty = (): void => {
        if (!privacySnapshot || !privacyMsg) {
            return;
        }
        const current = capturePrivacySnapshot();
        const changed: string[] = [];
        for (const [, key] of PRIVACY_CHECKBOX_IDS) {
            if (
                current[key as keyof PrivacySnapshot] !==
                privacySnapshot[key as keyof PrivacySnapshot]
            ) {
                changed.push(PRIVACY_LABELS[key] || key);
            }
        }
        if (changed.length > 0) {
            privacyMsg.textContent = tFmt(
                I18nKey.meSettingsPrivacyDirtyNotice,
                {
                    fields: changed.join("、"),
                },
            );
        } else {
            privacyMsg.textContent = "";
        }
    };

    // ---- mutable state ----
    let currentLoginEmail = "";
    let currentAvatarFileId = "";
    let currentAvatarFallbackUrl = "";
    let pendingAvatarUpload: { blob: Blob; previewUrl: string } | null = null;
    let avatarCropObjectUrl = "";
    let avatarCropLoaded = false;
    let avatarCropImageWidth = 0;
    let avatarCropImageHeight = 0;
    let avatarCropViewportSize = 0;
    let avatarCropMinScale = 1;
    let avatarCropScale = 1;
    let avatarCropOffsetX = 0;
    let avatarCropOffsetY = 0;
    let avatarCropPointerId: number | null = null;
    let avatarCropPointerX = 0;
    let avatarCropPointerY = 0;
    let avatarUploading = false;

    // ---- DOM helpers (closures over fresh refs) ----

    const clearPendingAvatarUpload = (revokePreview = true): void => {
        if (!pendingAvatarUpload) {
            return;
        }
        if (revokePreview) {
            URL.revokeObjectURL(pendingAvatarUpload.previewUrl);
        }
        pendingAvatarUpload = null;
    };

    const toSafeFileLabel = (value: string): string =>
        String(value || "")
            .trim()
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/\s+/g, " ");

    const updateAvatarPreview = (): void => {
        if (!avatarPreviewEl) {
            return;
        }
        const avatarUrl = avatarUrlInput
            ? String(avatarUrlInput.value || "").trim()
            : "";
        const src =
            avatarUrl ||
            pendingAvatarUpload?.previewUrl ||
            buildAssetUrl(currentAvatarFileId) ||
            currentAvatarFallbackUrl;
        avatarPreviewEl.src = src || EMPTY_AVATAR_SRC;
    };

    const setProfileMessage = (message: string): void => {
        if (profileMsg) {
            profileMsg.textContent = message;
        }
    };

    const setCropMessage = (message: string): void => {
        if (avatarCropMsg) {
            avatarCropMsg.textContent = message;
        }
    };

    const setUsernameEditing = (editing: boolean, focusInput = false): void => {
        if (!usernameDisplayBtn || !usernameEditor) {
            return;
        }
        usernameDisplayBtn.classList.toggle("hidden", editing);
        usernameEditor.classList.toggle("hidden", !editing);
        if (editing && focusInput && usernameInput) {
            window.requestAnimationFrame(() => {
                usernameInput.focus();
                const length = usernameInput.value.length;
                usernameInput.setSelectionRange(length, length);
            });
        }
    };

    const setBioEditing = (editing: boolean, focusInput = false): void => {
        if (!bioDisplayBtn || !bioEditor) {
            return;
        }
        bioDisplayBtn.classList.toggle("hidden", editing);
        bioEditor.classList.toggle("hidden", !editing);
        if (editing && focusInput && bioInput) {
            window.requestAnimationFrame(() => {
                bioInput.focus();
                const length = bioInput.value.length;
                bioInput.setSelectionRange(length, length);
            });
        }
    };

    const updateUsernameCounter = (): void => {
        if (!usernameInput || !usernameCounter) {
            return;
        }
        const current = weightedCharLength(
            String(usernameInput.value || "").trim(),
        );
        usernameCounter.textContent = `${current}/${USERNAME_MAX_WEIGHT}`;
    };

    const updateUsernameDisplay = (): void => {
        if (!usernameDisplayText || !usernameInput) {
            return;
        }
        const text = String(usernameInput.value || "").trim();
        const hasValue = Boolean(text);
        usernameDisplayText.textContent = hasValue
            ? text
            : t(I18nKey.meSettingsUsernameClickEdit);
        usernameDisplayText.classList.toggle("text-60", !hasValue);
    };

    const updateBioCounter = (): void => {
        if (!bioInput || !bioCounter) {
            return;
        }
        const current = weightedCharLength(String(bioInput.value || ""));
        bioCounter.textContent = `${current}/${PROFILE_BIO_MAX_LENGTH}`;
    };

    const updateBioDisplay = (): void => {
        if (!bioDisplayText || !bioInput) {
            return;
        }
        const text = String(bioInput.value || "").trim();
        const hasValue = Boolean(text);
        bioDisplayText.textContent = hasValue
            ? text
            : t(I18nKey.meSettingsBioClickEdit);
        bioDisplayText.classList.toggle("text-60", !hasValue);
    };

    const setDisplaynameEditing = (
        editing: boolean,
        focusInput = false,
    ): void => {
        if (!displaynameDisplayBtn || !displaynameEditor) {
            return;
        }
        displaynameDisplayBtn.classList.toggle("hidden", editing);
        displaynameEditor.classList.toggle("hidden", !editing);
        if (editing && focusInput && displaynameInput) {
            window.requestAnimationFrame(() => {
                displaynameInput.focus();
                const length = displaynameInput.value.length;
                displaynameInput.setSelectionRange(length, length);
            });
        }
    };

    const updateDisplaynameCounter = (): void => {
        if (!displaynameInput || !displaynameCounter) {
            return;
        }
        const current = weightedCharLength(
            String(displaynameInput.value || "").trim(),
        );
        displaynameCounter.textContent = `${current}/${DISPLAY_NAME_MAX_WEIGHT}`;
    };

    const updateDisplaynameDisplay = (): void => {
        if (!displaynameDisplayText || !displaynameInput) {
            return;
        }
        const text = String(displaynameInput.value || "").trim();
        const hasValue = Boolean(text);
        displaynameDisplayText.textContent = hasValue
            ? text
            : t(I18nKey.meSettingsDisplayNameClickEdit);
        displaynameDisplayText.classList.toggle("text-60", !hasValue);
    };

    const validateDisplaynameInput = (): string | null => {
        if (!displaynameInput) {
            return null;
        }
        const raw = String(displaynameInput.value || "").trim();
        if (!raw) {
            return t(I18nKey.meSettingsDisplayNameRequired);
        }
        if (weightedCharLength(raw) > DISPLAY_NAME_MAX_WEIGHT) {
            return t(I18nKey.meSettingsDisplayNameTooLong);
        }
        return null;
    };

    const SOCIAL_PLATFORMS = [
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
    ];

    const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
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

    const createSocialLinkRow = (
        platform = "",
        linkUrl = "",
        enabled = false,
    ): HTMLElement => {
        const row = document.createElement("div");
        row.className = "flex flex-wrap items-center gap-2";
        row.draggable = true;

        // 拖拽手柄
        const dragHandle = document.createElement("span");
        dragHandle.className =
            "cursor-grab active:cursor-grabbing text-30 hover:text-60 transition-colors select-none text-base leading-none";
        dragHandle.textContent = "≡";
        dragHandle.title = t(I18nKey.meSettingsDragSort);
        row.appendChild(dragHandle);

        // 切换启用状态
        const toggleWrap = document.createElement("label");
        toggleWrap.className =
            "flex items-center gap-1.5 text-sm text-60 cursor-pointer select-none";
        const checkInput = document.createElement("input");
        checkInput.type = "checkbox";
        checkInput.checked = enabled;
        checkInput.dataset.socialField = "enabled";
        checkInput.className = "toggle-checkbox";
        const track = document.createElement("span");
        track.className = "toggle-track";
        const knob = document.createElement("span");
        knob.className = "toggle-knob";
        track.appendChild(knob);
        toggleWrap.appendChild(checkInput);
        toggleWrap.appendChild(track);
        row.appendChild(toggleWrap);

        const select = document.createElement("select");
        select.className =
            "rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent";
        select.dataset.socialField = "platform";
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = t(I18nKey.meSettingsSocialSelectPlatform);
        select.appendChild(defaultOption);
        for (const p of SOCIAL_PLATFORMS) {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = SOCIAL_PLATFORM_LABELS[p] || p;
            if (p === platform) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }
        row.appendChild(select);

        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.placeholder = t(I18nKey.meSettingsSocialLinkUrl);
        urlInput.value = linkUrl;
        urlInput.className =
            "flex-1 min-w-[120px] rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent placeholder:text-50";
        urlInput.dataset.socialField = "url";
        row.appendChild(urlInput);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = t(I18nKey.commonDelete);
        removeBtn.className =
            "px-3 py-1.5 rounded-lg border border-(--line-divider) text-sm text-75 hover:text-red-500 hover:border-red-300 transition-colors";
        removeBtn.addEventListener("click", () => {
            row.remove();
        });
        row.appendChild(removeBtn);

        // 校验：URL 为空时不能启用
        const syncToggleState = (): void => {
            const canEnable =
                select.value.trim() !== "" && urlInput.value.trim() !== "";
            if (!canEnable && checkInput.checked) {
                checkInput.checked = false;
            }
            toggleWrap.classList.toggle("opacity-40", !canEnable);
            toggleWrap.classList.toggle("pointer-events-none", !canEnable);
        };
        select.addEventListener("change", syncToggleState);
        urlInput.addEventListener("input", syncToggleState);
        // 初始化状态
        syncToggleState();

        // 拖拽事件
        row.addEventListener("dragstart", (e) => {
            row.classList.add("opacity-40");
            e.dataTransfer?.setData("text/plain", "");
            socialDragSource = row;
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("opacity-40");
            socialDragSource = null;
            // 清除所有行的高亮
            socialLinksList
                ?.querySelectorAll(":scope > div")
                .forEach((el) => ((el as HTMLElement).style.borderTop = ""));
        });
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (socialDragSource && socialDragSource !== row) {
                row.style.borderTop = "2px solid var(--primary)";
            }
        });
        row.addEventListener("dragleave", () => {
            row.style.borderTop = "";
        });
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.style.borderTop = "";
            if (
                !socialDragSource ||
                socialDragSource === row ||
                !socialLinksList
            ) {
                return;
            }
            // 在目标位置前插入被拖拽行
            const rows = [...socialLinksList.children];
            const fromIdx = rows.indexOf(socialDragSource);
            const toIdx = rows.indexOf(row);
            if (fromIdx < toIdx) {
                row.after(socialDragSource);
            } else {
                row.before(socialDragSource);
            }
        });

        return row;
    };

    let socialDragSource: HTMLElement | null = null;

    const createSocialAddDivider = (): HTMLElement => {
        const wrap = document.createElement("button");
        wrap.type = "button";
        wrap.className =
            "flex items-center gap-2 w-full py-1.5 group/add cursor-pointer";
        const lineL = document.createElement("span");
        lineL.className =
            "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
        const label = document.createElement("span");
        label.className =
            "px-4 py-1.5 rounded-lg border border-(--line-divider) text-sm text-60 group-hover/add:border-(--primary) group-hover/add:text-(--primary) transition-colors whitespace-nowrap select-none";
        label.textContent = t(I18nKey.meSettingsSocialAddLink);
        const lineR = document.createElement("span");
        lineR.className =
            "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
        wrap.appendChild(lineL);
        wrap.appendChild(label);
        wrap.appendChild(lineR);
        wrap.addEventListener("click", () => {
            if (!socialLinksList) {
                return;
            }
            // 已有空白行时不再添加
            const rows = socialLinksList.querySelectorAll(":scope > div");
            for (const r of rows) {
                const p = (
                    r.querySelector(
                        '[data-social-field="platform"]',
                    ) as HTMLSelectElement | null
                )?.value;
                const u = (
                    r.querySelector(
                        '[data-social-field="url"]',
                    ) as HTMLInputElement | null
                )?.value;
                if (!p && !u) {
                    // 聚焦到已有的空白行
                    (
                        r.querySelector(
                            '[data-social-field="platform"]',
                        ) as HTMLElement | null
                    )?.focus();
                    return;
                }
            }
            const newRow = createSocialLinkRow();
            socialLinksList.insertBefore(newRow, wrap);
            (
                newRow.querySelector(
                    '[data-social-field="platform"]',
                ) as HTMLElement | null
            )?.focus();
        });
        return wrap;
    };

    const fillSocialLinks = (
        links: Array<{
            platform: string;
            url: string;
            enabled: boolean;
        }> | null,
    ): void => {
        if (!socialLinksList) {
            return;
        }
        socialLinksList.innerHTML = "";
        if (links && links.length > 0) {
            for (const link of links) {
                socialLinksList.appendChild(
                    createSocialLinkRow(link.platform, link.url, link.enabled),
                );
            }
        }
        socialLinksList.appendChild(createSocialAddDivider());
    };

    const collectSocialLinks = (): Array<{
        platform: string;
        url: string;
        enabled: boolean;
    }> => {
        if (!socialLinksList) {
            return [];
        }
        const rows = socialLinksList.querySelectorAll(":scope > div");
        const result: Array<{
            platform: string;
            url: string;
            enabled: boolean;
        }> = [];
        for (const row of rows) {
            const platformEl = row.querySelector(
                '[data-social-field="platform"]',
            ) as HTMLSelectElement | null;
            const urlEl = row.querySelector(
                '[data-social-field="url"]',
            ) as HTMLInputElement | null;
            const enabledEl = row.querySelector(
                '[data-social-field="enabled"]',
            ) as HTMLInputElement | null;
            const platform = platformEl?.value?.trim() || "";
            const url = urlEl?.value?.trim() || "";
            if (platform && url) {
                result.push({
                    platform,
                    url,
                    enabled: enabledEl?.checked ?? true,
                });
            }
        }
        return result;
    };

    const validateUsernameInput = (): string | null => {
        if (!usernameInput) {
            return null;
        }
        const raw = String(usernameInput.value || "").trim();
        if (!raw) {
            return t(I18nKey.meSettingsUsernameRequired);
        }
        if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
            return t(I18nKey.meSettingsUsernameRule);
        }
        if (weightedCharLength(raw) > USERNAME_MAX_WEIGHT) {
            return t(I18nKey.meSettingsUsernameTooLong);
        }
        return null;
    };

    const validateBioInput = (): string | null => {
        if (!bioInput) {
            return null;
        }
        if (
            weightedCharLength(String(bioInput.value || "")) >
            PROFILE_BIO_MAX_LENGTH
        ) {
            return t(I18nKey.meSettingsBioTooLong);
        }
        return null;
    };

    const validateBioTypewriterInput = (): string | null => {
        if (!bioTypewriterSpeedInput) {
            return null;
        }
        const speed = Math.floor(Number(bioTypewriterSpeedInput.value) || 80);
        if (
            speed < PROFILE_BIO_TYPEWRITER_SPEED_MIN ||
            speed > PROFILE_BIO_TYPEWRITER_SPEED_MAX
        ) {
            return t(I18nKey.meSettingsBioTypewriterSpeedRule);
        }
        return null;
    };

    // ---- avatar crop helpers ----

    const revokeAvatarCropObjectUrl = (): void => {
        if (avatarCropObjectUrl) {
            URL.revokeObjectURL(avatarCropObjectUrl);
            avatarCropObjectUrl = "";
        }
    };

    const setAvatarCropEmptyVisible = (visible: boolean): void => {
        if (avatarCropEmpty) {
            avatarCropEmpty.classList.toggle("hidden", !visible);
        }
    };

    const setAvatarCropApplyEnabled = (enabled: boolean): void => {
        if (avatarCropApplyBtn) {
            avatarCropApplyBtn.disabled = !enabled;
        }
    };

    const updateAvatarCropApplyState = (): void => {
        setAvatarCropApplyEnabled(avatarCropLoaded && !avatarUploading);
        if (avatarCropApplyBtn) {
            avatarCropApplyBtn.textContent = avatarUploading
                ? t(I18nKey.commonUploading)
                : t(I18nKey.commonApplyCrop);
        }
    };

    const resetAvatarCropState = (): void => {
        revokeAvatarCropObjectUrl();
        avatarCropLoaded = false;
        avatarCropImageWidth = 0;
        avatarCropImageHeight = 0;
        avatarCropViewportSize = 0;
        avatarCropMinScale = 1;
        avatarCropScale = 1;
        avatarCropOffsetX = 0;
        avatarCropOffsetY = 0;
        avatarCropPointerId = null;
        avatarCropPointerX = 0;
        avatarCropPointerY = 0;
        if (avatarCropImage) {
            avatarCropImage.removeAttribute("src");
            avatarCropImage.classList.add("hidden");
            avatarCropImage.style.transform = "";
            avatarCropImage.style.width = "";
            avatarCropImage.style.height = "";
            avatarCropImage.style.transformOrigin = "top left";
        }
        if (avatarCropZoomInput) {
            avatarCropZoomInput.value = String(AVATAR_CROP_ZOOM_MIN);
        }
        setAvatarCropEmptyVisible(true);
        updateAvatarCropApplyState();
    };

    const openAvatarCropModal = (): void => {
        if (!avatarCropModal) {
            setProfileMessage(t(I18nKey.meSettingsCropInitFailed));
            return;
        }
        avatarCropModal.classList.remove("hidden");
        avatarCropModal.classList.add("flex");
        document.body.classList.add("overflow-hidden");
        avatarCropModal.focus();
    };

    const closeAvatarCropModal = (): void => {
        if (!avatarCropModal) {
            return;
        }
        avatarCropModal.classList.remove("flex");
        avatarCropModal.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
        if (avatarCropFileInput) {
            avatarCropFileInput.value = "";
        }
        resetAvatarCropState();
        avatarUploading = false;
        updateAvatarCropApplyState();
        setCropMessage("");
    };

    const measureAvatarCropViewportSize = (): number => {
        if (!avatarCropViewport) {
            return 0;
        }
        const rect = avatarCropViewport.getBoundingClientRect();
        return Math.max(0, Math.floor(Math.min(rect.width, rect.height)));
    };

    const clampAvatarCropOffset = (): void => {
        if (!avatarCropLoaded || avatarCropViewportSize <= 0) {
            return;
        }
        const scaledWidth = avatarCropImageWidth * avatarCropScale;
        const scaledHeight = avatarCropImageHeight * avatarCropScale;
        const minX = avatarCropViewportSize - scaledWidth;
        const minY = avatarCropViewportSize - scaledHeight;
        avatarCropOffsetX = clamp(avatarCropOffsetX, minX, 0);
        avatarCropOffsetY = clamp(avatarCropOffsetY, minY, 0);
    };

    const renderAvatarCropImage = (): void => {
        if (!avatarCropImage) {
            return;
        }
        if (!avatarCropLoaded) {
            avatarCropImage.classList.add("hidden");
            setAvatarCropEmptyVisible(true);
            return;
        }
        clampAvatarCropOffset();
        avatarCropImage.classList.remove("hidden");
        avatarCropImage.style.width = `${avatarCropImageWidth}px`;
        avatarCropImage.style.height = `${avatarCropImageHeight}px`;
        avatarCropImage.style.transformOrigin = "top left";
        avatarCropImage.style.transform = `translate3d(${avatarCropOffsetX}px, ${avatarCropOffsetY}px, 0) scale(${avatarCropScale})`;
        setAvatarCropEmptyVisible(false);
    };

    const setAvatarCropScaleFromZoom = (
        zoomPercent: number,
        anchorX: number,
        anchorY: number,
    ): void => {
        if (!avatarCropLoaded || avatarCropViewportSize <= 0) {
            return;
        }
        const normalizedZoom = clamp(
            Number.isFinite(zoomPercent) ? zoomPercent : AVATAR_CROP_ZOOM_MIN,
            AVATAR_CROP_ZOOM_MIN,
            AVATAR_CROP_ZOOM_MAX,
        );
        const nextScale = avatarCropMinScale * (normalizedZoom / 100);
        const safeAnchorX = clamp(anchorX, 0, avatarCropViewportSize);
        const safeAnchorY = clamp(anchorY, 0, avatarCropViewportSize);
        const imagePointX = (safeAnchorX - avatarCropOffsetX) / avatarCropScale;
        const imagePointY = (safeAnchorY - avatarCropOffsetY) / avatarCropScale;
        avatarCropScale = nextScale;
        avatarCropOffsetX = safeAnchorX - imagePointX * avatarCropScale;
        avatarCropOffsetY = safeAnchorY - imagePointY * avatarCropScale;
        clampAvatarCropOffset();
        renderAvatarCropImage();
        if (avatarCropZoomInput) {
            avatarCropZoomInput.value = String(Math.round(normalizedZoom));
        }
    };

    const loadAvatarCropFile = (file: File): void => {
        if (!avatarCropImage) {
            setCropMessage(t(I18nKey.meSettingsCropInitFailed));
            return;
        }
        if (!file.type.startsWith("image/")) {
            setCropMessage(t(I18nKey.commonSelectImage));
            return;
        }
        if (file.size > UPLOAD_LIMITS.avatar) {
            setCropMessage(
                tFmt(I18nKey.commonImageTooLarge, {
                    size: UPLOAD_LIMIT_LABELS.avatar,
                }),
            );
            return;
        }
        setCropMessage("");
        const nextObjectUrl = URL.createObjectURL(file);
        const img = avatarCropImage;
        img.onload = () => {
            avatarCropLoaded = true;
            avatarCropImageWidth = Math.max(1, img.naturalWidth);
            avatarCropImageHeight = Math.max(1, img.naturalHeight);
            avatarCropViewportSize = measureAvatarCropViewportSize();
            if (avatarCropViewportSize <= 0) {
                avatarCropViewportSize = 320;
            }
            avatarCropMinScale = Math.max(
                avatarCropViewportSize / avatarCropImageWidth,
                avatarCropViewportSize / avatarCropImageHeight,
            );
            avatarCropScale = avatarCropMinScale;
            avatarCropOffsetX =
                (avatarCropViewportSize -
                    avatarCropImageWidth * avatarCropScale) /
                2;
            avatarCropOffsetY =
                (avatarCropViewportSize -
                    avatarCropImageHeight * avatarCropScale) /
                2;
            if (avatarCropZoomInput) {
                avatarCropZoomInput.value = String(AVATAR_CROP_ZOOM_MIN);
            }
            renderAvatarCropImage();
            updateAvatarCropApplyState();
            setProfileMessage("");
        };
        img.onerror = () => {
            setCropMessage(t(I18nKey.commonImageReadFailed));
            resetAvatarCropState();
        };
        revokeAvatarCropObjectUrl();
        avatarCropObjectUrl = nextObjectUrl;
        img.src = nextObjectUrl;
    };

    const buildAvatarCropBlob = async (): Promise<Blob | null> => {
        if (!avatarCropLoaded || !avatarCropImage) {
            return null;
        }
        if (avatarCropViewportSize <= 0) {
            return null;
        }
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_CROP_OUTPUT_SIZE;
        canvas.height = AVATAR_CROP_OUTPUT_SIZE;
        const context = canvas.getContext("2d");
        if (!context) {
            return null;
        }
        const ratio = AVATAR_CROP_OUTPUT_SIZE / avatarCropViewportSize;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
            avatarCropImage,
            avatarCropOffsetX * ratio,
            avatarCropOffsetY * ratio,
            avatarCropImageWidth * avatarCropScale * ratio,
            avatarCropImageHeight * avatarCropScale * ratio,
        );
        return await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
        });
    };

    const applyAvatarFromCrop = async (): Promise<void> => {
        if (!avatarCropLoaded) {
            setCropMessage(t(I18nKey.meSettingsAvatarSelectFirst));
            return;
        }
        avatarUploading = true;
        updateAvatarCropApplyState();
        try {
            const croppedBlob = await buildAvatarCropBlob();
            if (!croppedBlob) {
                setCropMessage(t(I18nKey.meSettingsAvatarCropFailed));
                return;
            }
            clearPendingAvatarUpload(true);
            pendingAvatarUpload = {
                blob: croppedBlob,
                previewUrl: URL.createObjectURL(croppedBlob),
            };
            currentAvatarFileId = "";
            currentAvatarFallbackUrl = "";
            if (avatarUrlInput) {
                avatarUrlInput.value = "";
            }
            updateAvatarPreview();
            closeAvatarCropModal();
            checkProfileDirty();
        } finally {
            avatarUploading = false;
            updateAvatarCropApplyState();
        }
    };

    const uploadPendingAvatarIfNeeded = async (
        taskHandle?: ProgressTaskHandle,
    ): Promise<boolean> => {
        const avatarUrl = avatarUrlInput
            ? String(avatarUrlInput.value || "").trim()
            : "";
        if (avatarUrl || !pendingAvatarUpload) {
            return true;
        }
        setProfileMessage(t(I18nKey.meSettingsAvatarUploading));
        if (typeof taskHandle === "number") {
            updateTask(taskHandle, {
                text: t(I18nKey.meSettingsAvatarUploadingText),
            });
        }
        const formData = new FormData();
        const avatarTitleBase = `Avatar-${toSafeFileLabel(currentLoginEmail || "unknown")}`;
        formData.append(
            "file",
            pendingAvatarUpload.blob,
            `${avatarTitleBase}.jpg`,
        );
        formData.append("title", avatarTitleBase);
        formData.append("purpose", "avatar");
        const { response, data } = await api("/api/v1/uploads", {
            method: "POST",
            body: formData,
        });
        if (
            !response.ok ||
            !data?.ok ||
            !(data?.file as Record<string, unknown> | undefined)?.id
        ) {
            setProfileMessage(
                getApiErrorMessage(
                    data,
                    t(I18nKey.meSettingsAvatarUploadFailed),
                ),
            );
            return false;
        }
        clearPendingAvatarUpload(true);
        currentAvatarFileId = String((data.file as Record<string, unknown>).id);
        return true;
    };

    // ---- fill helpers ----

    const fillProfile = (
        profile: Record<string, unknown> | null | undefined,
        fallbackAvatarUrl = "",
    ): void => {
        clearPendingAvatarUpload(true);
        if (usernameInput) {
            usernameInput.value = (profile?.username as string) || "";
            updateUsernameCounter();
            updateUsernameDisplay();
            setUsernameEditing(false);
        }
        if (displaynameInput) {
            displaynameInput.value = (profile?.display_name as string) || "";
            updateDisplaynameCounter();
            updateDisplaynameDisplay();
            setDisplaynameEditing(false);
        }
        if (avatarUrlInput) {
            avatarUrlInput.value = (profile?.avatar_url as string) || "";
        }
        currentAvatarFileId = extractFileId(profile?.avatar_file);
        currentAvatarFallbackUrl = String(fallbackAvatarUrl || "").trim();
        updateAvatarPreview();
        if (bioInput) {
            bioInput.value = (profile?.bio as string) || "";
            updateBioCounter();
            updateBioDisplay();
            setBioEditing(false);
        }
        if (bioTypewriterEnableInput) {
            bioTypewriterEnableInput.checked = Boolean(
                profile?.bio_typewriter_enable ?? true,
            );
        }
        if (bioTypewriterSpeedInput) {
            const speed = Math.max(
                PROFILE_BIO_TYPEWRITER_SPEED_MIN,
                Math.min(
                    PROFILE_BIO_TYPEWRITER_SPEED_MAX,
                    Math.floor(Number(profile?.bio_typewriter_speed) || 80),
                ),
            );
            bioTypewriterSpeedInput.value = String(speed);
        }
        fillSocialLinks(
            Array.isArray(profile?.social_links)
                ? (profile.social_links as Array<{
                      platform: string;
                      url: string;
                      enabled: boolean;
                  }>)
                : null,
        );
        profileSnapshot = captureProfileSnapshot();
    };

    const fillPrivacy = (
        privacy: Record<string, unknown> | null | undefined,
    ): void => {
        const ids: [string, string][] = [
            ["pv-profile-public", "profile_public"],
            ["pv-show-articles", "show_articles_on_profile"],
            ["pv-show-diaries", "show_diaries_on_profile"],
            ["pv-show-albums", "show_albums_on_profile"],
            ["pv-show-comments", "show_comments_on_profile"],
        ];
        for (const [elId, key] of ids) {
            const el = document.getElementById(elId) as HTMLInputElement | null;
            if (el) {
                el.checked = Boolean(privacy?.[key]);
            }
        }
        privacySnapshot = capturePrivacySnapshot();
    };

    const loadAuthMe = async (): Promise<ApiResult> => {
        let result = await api("/api/auth/me");
        if (
            (!result.response.ok || !result.data?.ok) &&
            result.response.status === 401
        ) {
            await new Promise<void>((resolve) =>
                window.setTimeout(resolve, AUTH_ME_RETRY_DELAY_MS),
            );
            result = await api("/api/auth/me");
        }
        return result;
    };

    // ---- initial state ----

    resetAvatarCropState();
    updateAvatarPreview();
    updateUsernameCounter();
    updateBioCounter();
    updateUsernameDisplay();
    updateBioDisplay();
    updateDisplaynameCounter();
    updateDisplaynameDisplay();
    setUsernameEditing(false);
    setBioEditing(false);
    setDisplaynameEditing(false);

    // ---- event bindings (guarded with data-bound to prevent duplicates) ----

    const profileForm = document.getElementById("me-profile-form");
    if (profileForm && !profileForm.hasAttribute(DATA_BOUND)) {
        profileForm.setAttribute(DATA_BOUND, "");
        profileForm.addEventListener("submit", async (event: Event) => {
            event.preventDefault();
            const usernameError = validateUsernameInput();
            if (usernameError) {
                setProfileMessage(usernameError);
                return;
            }
            const displaynameError = validateDisplaynameInput();
            if (displaynameError) {
                setProfileMessage(displaynameError);
                return;
            }
            const bioError = validateBioInput();
            if (bioError) {
                setProfileMessage(bioError);
                return;
            }
            const bioTypewriterError = validateBioTypewriterInput();
            if (bioTypewriterError) {
                setProfileMessage(bioTypewriterError);
                return;
            }
            await runWithTask(
                {
                    title: t(I18nKey.meSettingsSavingProfileTitle),
                    mode: "indeterminate",
                    text: t(I18nKey.meSettingsSavingProfileText),
                },
                async ({ handle, update }) => {
                    const avatarUploaded =
                        await uploadPendingAvatarIfNeeded(handle);
                    if (!avatarUploaded) {
                        return;
                    }
                    update({
                        text: t(I18nKey.meSettingsSavingProfileSubmitting),
                    });
                    const avatarUrl = avatarUrlInput
                        ? String(avatarUrlInput.value || "").trim()
                        : "";
                    const bioTypewriterSpeed = Math.max(
                        PROFILE_BIO_TYPEWRITER_SPEED_MIN,
                        Math.min(
                            PROFILE_BIO_TYPEWRITER_SPEED_MAX,
                            Math.floor(
                                Number(bioTypewriterSpeedInput?.value || 80) ||
                                    80,
                            ),
                        ),
                    );
                    const payload = {
                        username: usernameInput ? usernameInput.value : "",
                        display_name: displaynameInput
                            ? displaynameInput.value
                            : "",
                        bio: bioInput ? bioInput.value : "",
                        bio_typewriter_enable:
                            bioTypewriterEnableInput?.checked ?? true,
                        bio_typewriter_speed: bioTypewriterSpeed,
                        avatar_url: avatarUrl || null,
                        avatar_file: avatarUrl
                            ? null
                            : currentAvatarFileId || null,
                    };
                    const { response, data } = await api("/api/v1/me/profile", {
                        method: "PATCH",
                        body: JSON.stringify(payload),
                    });
                    if (!response.ok || !data?.ok) {
                        setProfileMessage(
                            getApiErrorMessage(
                                data,
                                t(I18nKey.commonSaveFailed),
                            ),
                        );
                        return;
                    }
                    update({ text: t(I18nKey.commonSaveCompletedReloading) });
                    setProfileMessage(t(I18nKey.commonSavedReloading));
                    window.setTimeout(() => {
                        window.location.reload();
                    }, 120);
                },
            );
        });
    }

    if (avatarUrlInput && !avatarUrlInput.hasAttribute(DATA_BOUND)) {
        avatarUrlInput.setAttribute(DATA_BOUND, "");
        avatarUrlInput.addEventListener("input", () => {
            if (String(avatarUrlInput.value || "").trim()) {
                clearPendingAvatarUpload(true);
            }
            updateAvatarPreview();
            checkProfileDirty();
        });
    }

    if (usernameInput && !usernameInput.hasAttribute(DATA_BOUND)) {
        usernameInput.setAttribute(DATA_BOUND, "");
        usernameInput.addEventListener("input", () => {
            updateUsernameCounter();
            updateUsernameDisplay();
            checkProfileDirty();
        });
    }

    if (bioInput && !bioInput.hasAttribute(DATA_BOUND)) {
        bioInput.setAttribute(DATA_BOUND, "");
        bioInput.addEventListener("input", () => {
            updateBioCounter();
            updateBioDisplay();
            checkProfileDirty();
        });
    }

    if (
        bioTypewriterEnableInput &&
        !bioTypewriterEnableInput.hasAttribute(DATA_BOUND)
    ) {
        bioTypewriterEnableInput.setAttribute(DATA_BOUND, "");
        bioTypewriterEnableInput.addEventListener("change", checkProfileDirty);
    }

    if (
        bioTypewriterSpeedInput &&
        !bioTypewriterSpeedInput.hasAttribute(DATA_BOUND)
    ) {
        bioTypewriterSpeedInput.setAttribute(DATA_BOUND, "");
        bioTypewriterSpeedInput.addEventListener("input", checkProfileDirty);
    }

    if (displaynameInput && !displaynameInput.hasAttribute(DATA_BOUND)) {
        displaynameInput.setAttribute(DATA_BOUND, "");
        displaynameInput.addEventListener("input", () => {
            updateDisplaynameCounter();
            updateDisplaynameDisplay();
            checkProfileDirty();
        });
    }

    if (usernameDisplayBtn && !usernameDisplayBtn.hasAttribute(DATA_BOUND)) {
        usernameDisplayBtn.setAttribute(DATA_BOUND, "");
        usernameDisplayBtn.addEventListener("click", () =>
            setUsernameEditing(true, true),
        );
    }

    if (bioDisplayBtn && !bioDisplayBtn.hasAttribute(DATA_BOUND)) {
        bioDisplayBtn.setAttribute(DATA_BOUND, "");
        bioDisplayBtn.addEventListener("click", () =>
            setBioEditing(true, true),
        );
    }

    if (
        displaynameDisplayBtn &&
        !displaynameDisplayBtn.hasAttribute(DATA_BOUND)
    ) {
        displaynameDisplayBtn.setAttribute(DATA_BOUND, "");
        displaynameDisplayBtn.addEventListener("click", () =>
            setDisplaynameEditing(true, true),
        );
    }

    // 外部点击：先移除旧监听，再注册新监听
    const previousOutsideClick = runtimeWindow[OUTSIDE_CLICK_KEY];
    if (typeof previousOutsideClick === "function") {
        document.removeEventListener("click", previousOutsideClick);
    }

    const handleOutsideClick = (event: MouseEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }
        if (usernameEditor && !usernameEditor.classList.contains("hidden")) {
            const insideEditor = usernameEditor.contains(target);
            const insideDisplay = usernameDisplayBtn?.contains(target);
            if (!insideEditor && !insideDisplay) {
                setUsernameEditing(false);
            }
        }
        if (bioEditor && !bioEditor.classList.contains("hidden")) {
            const insideEditor = bioEditor.contains(target);
            const insideDisplay = bioDisplayBtn?.contains(target);
            if (!insideEditor && !insideDisplay) {
                setBioEditing(false);
            }
        }
        if (
            displaynameEditor &&
            !displaynameEditor.classList.contains("hidden")
        ) {
            const insideEditor = displaynameEditor.contains(target);
            const insideDisplay = displaynameDisplayBtn?.contains(target);
            if (!insideEditor && !insideDisplay) {
                setDisplaynameEditing(false);
            }
        }
    };
    document.addEventListener("click", handleOutsideClick);
    runtimeWindow[OUTSIDE_CLICK_KEY] = handleOutsideClick;

    // 头像上传与裁剪按钮
    if (avatarUploadBtn && !avatarUploadBtn.hasAttribute(DATA_BOUND)) {
        avatarUploadBtn.setAttribute(DATA_BOUND, "");
        avatarUploadBtn.addEventListener("click", () => {
            openAvatarCropModal();
            setProfileMessage("");
        });
    }

    if (avatarCropSelectBtn && !avatarCropSelectBtn.hasAttribute(DATA_BOUND)) {
        avatarCropSelectBtn.setAttribute(DATA_BOUND, "");
        avatarCropSelectBtn.addEventListener("click", () => {
            if (avatarCropFileInput) {
                avatarCropFileInput.click();
            }
        });
    }

    if (avatarCropFileInput && !avatarCropFileInput.hasAttribute(DATA_BOUND)) {
        avatarCropFileInput.setAttribute(DATA_BOUND, "");
        avatarCropFileInput.addEventListener("change", () => {
            const file = avatarCropFileInput.files?.[0];
            if (file) {
                loadAvatarCropFile(file);
            }
        });
    }

    if (avatarCropZoomInput && !avatarCropZoomInput.hasAttribute(DATA_BOUND)) {
        avatarCropZoomInput.setAttribute(DATA_BOUND, "");
        avatarCropZoomInput.addEventListener("input", () => {
            const zoom = Number.parseFloat(
                avatarCropZoomInput.value || String(AVATAR_CROP_ZOOM_MIN),
            );
            const anchor =
                avatarCropViewportSize > 0 ? avatarCropViewportSize / 2 : 0;
            setAvatarCropScaleFromZoom(zoom, anchor, anchor);
        });
    }

    if (avatarCropApplyBtn && !avatarCropApplyBtn.hasAttribute(DATA_BOUND)) {
        avatarCropApplyBtn.setAttribute(DATA_BOUND, "");
        avatarCropApplyBtn.addEventListener("click", async () => {
            await applyAvatarFromCrop();
        });
    }

    if (avatarCropCancelBtn && !avatarCropCancelBtn.hasAttribute(DATA_BOUND)) {
        avatarCropCancelBtn.setAttribute(DATA_BOUND, "");
        avatarCropCancelBtn.addEventListener("click", () => {
            if (!avatarUploading) {
                closeAvatarCropModal();
            }
        });
    }

    if (avatarCropModal && !avatarCropModal.hasAttribute(DATA_BOUND)) {
        avatarCropModal.setAttribute(DATA_BOUND, "");
        avatarCropModal.addEventListener("click", (event: MouseEvent) => {
            if (!avatarUploading && event.target === avatarCropModal) {
                closeAvatarCropModal();
            }
        });
        avatarCropModal.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape" && !avatarUploading) {
                closeAvatarCropModal();
            }
        });
    }

    if (avatarCropViewport && !avatarCropViewport.hasAttribute(DATA_BOUND)) {
        avatarCropViewport.setAttribute(DATA_BOUND, "");
        avatarCropViewport.addEventListener(
            "pointerdown",
            (event: PointerEvent) => {
                if (!avatarCropLoaded || !avatarCropViewport) {
                    return;
                }
                avatarCropPointerId = event.pointerId;
                avatarCropPointerX = event.clientX;
                avatarCropPointerY = event.clientY;
                avatarCropViewport.setPointerCapture(event.pointerId);
                event.preventDefault();
            },
        );
        avatarCropViewport.addEventListener(
            "pointermove",
            (event: PointerEvent) => {
                if (
                    !avatarCropLoaded ||
                    avatarCropPointerId !== event.pointerId
                ) {
                    return;
                }
                const deltaX = event.clientX - avatarCropPointerX;
                const deltaY = event.clientY - avatarCropPointerY;
                avatarCropPointerX = event.clientX;
                avatarCropPointerY = event.clientY;
                avatarCropOffsetX += deltaX;
                avatarCropOffsetY += deltaY;
                renderAvatarCropImage();
                event.preventDefault();
            },
        );
        const releasePointer = (event: PointerEvent): void => {
            if (
                avatarCropPointerId !== event.pointerId ||
                !avatarCropViewport
            ) {
                return;
            }
            if (avatarCropViewport.hasPointerCapture(event.pointerId)) {
                avatarCropViewport.releasePointerCapture(event.pointerId);
            }
            avatarCropPointerId = null;
        };
        avatarCropViewport.addEventListener("pointerup", releasePointer);
        avatarCropViewport.addEventListener("pointercancel", releasePointer);
    }

    if (avatarClearBtn && !avatarClearBtn.hasAttribute(DATA_BOUND)) {
        avatarClearBtn.setAttribute(DATA_BOUND, "");
        avatarClearBtn.addEventListener("click", () => {
            clearPendingAvatarUpload(true);
            currentAvatarFileId = "";
            currentAvatarFallbackUrl = "";
            if (avatarUrlInput) {
                avatarUrlInput.value = "";
            }
            if (avatarCropFileInput) {
                avatarCropFileInput.value = "";
            }
            updateAvatarPreview();
            checkProfileDirty();
        });
    }

    if (socialSaveBtn && !socialSaveBtn.hasAttribute(DATA_BOUND)) {
        socialSaveBtn.setAttribute(DATA_BOUND, "");
        socialSaveBtn.addEventListener("click", async () => {
            const links = collectSocialLinks();
            const setSocialMsg = (msg: string): void => {
                if (socialMsg) {
                    socialMsg.textContent = msg;
                }
            };
            setSocialMsg(t(I18nKey.commonSaving));
            await runWithTask(
                {
                    title: t(I18nKey.meSettingsSavingSocialTitle),
                    mode: "indeterminate",
                    text: t(I18nKey.commonSaving),
                },
                async ({ update }) => {
                    try {
                        const { response, data } = await api(
                            "/api/v1/me/profile",
                            {
                                method: "PATCH",
                                body: JSON.stringify({ social_links: links }),
                            },
                        );
                        if (!response.ok || !data?.ok) {
                            setSocialMsg(
                                getApiErrorMessage(
                                    data,
                                    t(I18nKey.commonSaveFailed),
                                ),
                            );
                            return;
                        }
                        update({
                            text: t(I18nKey.commonSaveCompletedReloading),
                        });
                        setSocialMsg(t(I18nKey.commonSavedReloading));
                        window.setTimeout(() => {
                            window.location.reload();
                        }, 120);
                    } catch {
                        setSocialMsg(t(I18nKey.commonSaveFailedRetry));
                    }
                },
            );
        });
    }

    const privacyForm = document.getElementById("me-privacy-form");

    // 为隐私复选框绑定脏状态检测
    for (const [elId] of PRIVACY_CHECKBOX_IDS) {
        const el = document.getElementById(elId) as HTMLInputElement | null;
        if (el && !el.hasAttribute(DATA_BOUND)) {
            el.setAttribute(DATA_BOUND, "");
            el.addEventListener("change", checkPrivacyDirty);
        }
    }

    if (privacyForm && !privacyForm.hasAttribute(DATA_BOUND)) {
        privacyForm.setAttribute(DATA_BOUND, "");
        privacyForm.addEventListener("submit", async (event: Event) => {
            event.preventDefault();
            const ids: [string, string][] = [
                ["pv-profile-public", "profile_public"],
                ["pv-show-articles", "show_articles_on_profile"],
                ["pv-show-diaries", "show_diaries_on_profile"],
                ["pv-show-albums", "show_albums_on_profile"],
                ["pv-show-comments", "show_comments_on_profile"],
            ];
            const payload: Record<string, boolean> = {};
            for (const [elId, key] of ids) {
                const el = document.getElementById(
                    elId,
                ) as HTMLInputElement | null;
                payload[key] = el?.checked ?? false;
            }
            await runWithTask(
                {
                    title: t(I18nKey.meSettingsSavingPrivacyTitle),
                    mode: "indeterminate",
                    text: t(I18nKey.commonSaving),
                },
                async ({ update }) => {
                    const { response, data } = await api("/api/v1/me/privacy", {
                        method: "PATCH",
                        body: JSON.stringify(payload),
                    });
                    if (!privacyMsg) {
                        return;
                    }
                    if (response.ok && data?.ok) {
                        update({
                            text: t(I18nKey.commonSaveCompletedReloading),
                        });
                        privacySnapshot = capturePrivacySnapshot();
                        privacyMsg.textContent = t(
                            I18nKey.commonSavedReloading,
                        );
                        window.setTimeout(() => {
                            window.location.reload();
                        }, 120);
                        return;
                    }
                    privacyMsg.textContent = getApiErrorMessage(
                        data,
                        t(I18nKey.commonSaveFailed),
                    );
                },
            );
        });
    }

    // 启动鉴权与数据初始化流程

    const runInit = async (): Promise<void> => {
        authenticatedSections.classList.add("hidden");
        const me = await loadAuthMe();
        if (!me.response.ok || !me.data?.ok) {
            window.location.href = buildLoginRedirectHref();
            return;
        }
        const loginEmail = String(
            (me.data.user as Record<string, unknown> | undefined)?.email || "",
        ).trim();
        currentLoginEmail = loginEmail;
        const fallbackAvatarUrl = String(
            (me.data.user as Record<string, unknown> | undefined)?.avatarUrl ||
                "",
        ).trim();
        if (emailInput) {
            emailInput.value = loginEmail;
        }
        currentAvatarFallbackUrl = fallbackAvatarUrl;
        updateAvatarPreview();

        const [profileResp, privacyResp] = await Promise.all([
            api("/api/v1/me/profile"),
            api("/api/v1/me/privacy"),
        ]);
        if (profileResp.response.ok && profileResp.data?.ok) {
            fillProfile(
                profileResp.data.profile as Record<string, unknown> | undefined,
                fallbackAvatarUrl,
            );
        }
        if (privacyResp.response.ok && privacyResp.data?.ok) {
            fillPrivacy(
                privacyResp.data.privacy as Record<string, unknown> | undefined,
            );
        }
        authenticatedSections.classList.remove("hidden");
    };

    runInit().catch((err) => {
        console.error("[me-page] init failed", err);
    });
}

// 初始化由全局 layout 运行时通过动态导入触发，而非模块级自动执行。
// 这样可避免在切页时重复执行页面脚本。
