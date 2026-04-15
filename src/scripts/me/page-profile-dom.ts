/**
 * /me/ 账户设置页：DOM 查询、快照、输入校验与 DOM 更新辅助。
 */

import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/shared/i18n-runtime";
import {
    weightedCharLength,
    USERNAME_MAX_WEIGHT,
    DISPLAY_NAME_MAX_WEIGHT,
    PROFILE_BIO_MAX_LENGTH,
} from "@/constants/text-limits";
import { buildAssetUrl } from "@/scripts/shared/dom-helpers";
import {
    EMPTY_AVATAR_SRC,
    PRIVACY_CHECKBOX_IDS,
} from "@/scripts/me/page-types";
import type {
    MePageDom,
    MePageState,
    ProfileSnapshot,
    PrivacySnapshot,
} from "@/scripts/me/page-types";

export type { MePageDom, MePageState, ProfileSnapshot, PrivacySnapshot };

// ---------------------------------------------------------------------------
// DOM 查询
// ---------------------------------------------------------------------------

export function queryDom(): MePageDom | null {
    const authenticatedSections = document.getElementById(
        "me-authenticated-sections",
    );
    if (!authenticatedSections) {
        return null;
    }
    return {
        authenticatedSections,
        profileMsg: document.getElementById("me-profile-msg"),
        privacyMsg: document.getElementById("me-privacy-msg"),
        logoutBtn: document.getElementById(
            "me-logout-btn",
        ) as HTMLButtonElement | null,
        emailInput: document.getElementById(
            "me-email",
        ) as HTMLInputElement | null,
        usernameDisplayBtn: document.getElementById(
            "me-username-display-btn",
        ) as HTMLButtonElement | null,
        usernameDisplayText: document.getElementById("me-username-display"),
        usernameEditor: document.getElementById("me-username-editor"),
        usernameInput: document.getElementById(
            "me-username",
        ) as HTMLInputElement | null,
        usernameCounter: document.getElementById("me-username-counter"),
        bioDisplayBtn: document.getElementById(
            "me-bio-display-btn",
        ) as HTMLButtonElement | null,
        bioDisplayText: document.getElementById("me-bio-display"),
        bioEditor: document.getElementById("me-bio-editor"),
        bioInput: document.getElementById(
            "me-bio",
        ) as HTMLTextAreaElement | null,
        bioCounter: document.getElementById("me-bio-counter"),
        displaynameDisplayBtn: document.getElementById(
            "me-displayname-display-btn",
        ) as HTMLButtonElement | null,
        displaynameDisplayText: document.getElementById(
            "me-displayname-display",
        ),
        displaynameEditor: document.getElementById("me-displayname-editor"),
        displaynameInput: document.getElementById(
            "me-displayname",
        ) as HTMLInputElement | null,
        displaynameCounter: document.getElementById("me-displayname-counter"),
        socialLinksList: document.getElementById("me-social-links-list"),
        socialSaveBtn: document.getElementById("me-social-save-btn"),
        socialMsg: document.getElementById("me-social-msg"),
        avatarPreviewEl: document.getElementById(
            "me-avatar-preview",
        ) as HTMLImageElement | null,
        avatarUploadBtn: document.getElementById("me-avatar-upload-btn"),
        avatarClearBtn: document.getElementById("me-avatar-clear-btn"),
        avatarCropModal: document.getElementById("me-avatar-crop-modal"),
        avatarCropViewport: document.getElementById(
            "me-avatar-crop-viewport",
        ) as HTMLElement | null,
        avatarCropImage: document.getElementById(
            "me-avatar-crop-image",
        ) as HTMLImageElement | null,
        avatarCropEmpty: document.getElementById("me-avatar-crop-empty"),
        avatarCropFileInput: document.getElementById(
            "me-avatar-crop-file",
        ) as HTMLInputElement | null,
        avatarCropSelectBtn: document.getElementById(
            "me-avatar-crop-select-btn",
        ),
        avatarCropApplyBtn: document.getElementById(
            "me-avatar-crop-apply-btn",
        ) as HTMLButtonElement | null,
        avatarCropCancelBtn: document.getElementById(
            "me-avatar-crop-cancel-btn",
        ),
        avatarCropZoomInput: document.getElementById(
            "me-avatar-crop-zoom",
        ) as HTMLInputElement | null,
        avatarCropMsg: document.getElementById("me-avatar-crop-msg"),
    };
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export function captureProfileSnapshot(
    dom: MePageDom,
    state: MePageState,
): ProfileSnapshot {
    return {
        username: dom.usernameInput
            ? String(dom.usernameInput.value || "").trim()
            : "",
        display_name: dom.displaynameInput
            ? String(dom.displaynameInput.value || "").trim()
            : "",
        bio: dom.bioInput ? String(dom.bioInput.value || "") : "",
        avatar_file_id: state.currentAvatarFileId,
        avatar_pending_upload: Boolean(state.pendingAvatarUpload),
    };
}

export function capturePrivacySnapshot(): PrivacySnapshot {
    const snap: Record<string, boolean> = {};
    for (const [elId, key] of PRIVACY_CHECKBOX_IDS) {
        const el = document.getElementById(elId) as HTMLInputElement | null;
        snap[key] = el?.checked ?? false;
    }
    return snap as unknown as PrivacySnapshot;
}

// ---------------------------------------------------------------------------
// 脏状态检测
// ---------------------------------------------------------------------------

export function checkProfileDirty(dom: MePageDom, state: MePageState): void {
    if (!state.profileSnapshot || !dom.profileMsg) {
        return;
    }
    const current = captureProfileSnapshot(dom, state);
    const snap = state.profileSnapshot;
    const changed: string[] = [];
    if (current.username !== snap.username) {
        changed.push(t(I18nKey.meSettingsUsernameLabel));
    }
    if (current.display_name !== snap.display_name) {
        changed.push(t(I18nKey.meSettingsDisplayNameLabel));
    }
    if (current.bio !== snap.bio) {
        changed.push(t(I18nKey.meSettingsBioLabel));
    }
    if (
        current.avatar_file_id !== snap.avatar_file_id ||
        current.avatar_pending_upload !== snap.avatar_pending_upload
    ) {
        changed.push(t(I18nKey.meSettingsAvatarLabel));
    }
    dom.profileMsg.textContent =
        changed.length > 0
            ? tFmt(I18nKey.meSettingsProfileDirtyNotice, {
                  fields: changed.join("、"),
              })
            : "";
}

export function checkPrivacyDirty(dom: MePageDom, state: MePageState): void {
    if (!state.privacySnapshot || !dom.privacyMsg) {
        return;
    }
    const current = capturePrivacySnapshot();
    const changed: string[] = [];
    const privacyLabels = createPrivacyLabels();
    for (const [, key] of PRIVACY_CHECKBOX_IDS) {
        if (
            current[key as keyof PrivacySnapshot] !==
            state.privacySnapshot[key as keyof PrivacySnapshot]
        ) {
            changed.push(privacyLabels[key] ?? key);
        }
    }
    dom.privacyMsg.textContent =
        changed.length > 0
            ? tFmt(I18nKey.meSettingsPrivacyDirtyNotice, {
                  fields: changed.join("、"),
              })
            : "";
}

function createPrivacyLabels(): Record<string, string> {
    return {
        profile_public: t(I18nKey.meSettingsPrivacyProfilePublic),
        show_articles: t(I18nKey.meSettingsPrivacyShowArticles),
        show_diaries: t(I18nKey.meSettingsPrivacyShowDiaries),
        show_albums: t(I18nKey.meSettingsPrivacyShowAlbums),
        show_comments: t(I18nKey.meSettingsPrivacyShowComments),
    };
}

// ---------------------------------------------------------------------------
// DOM 更新辅助
// ---------------------------------------------------------------------------

export function clearPendingAvatarUpload(
    state: MePageState,
    revokePreview = true,
): void {
    if (!state.pendingAvatarUpload) {
        return;
    }
    if (revokePreview) {
        URL.revokeObjectURL(state.pendingAvatarUpload.previewUrl);
    }
    state.pendingAvatarUpload = null;
}

export function updateAvatarPreview(dom: MePageDom, state: MePageState): void {
    if (!dom.avatarPreviewEl) {
        return;
    }
    const src =
        state.pendingAvatarUpload?.previewUrl ||
        buildAssetUrl(state.currentAvatarFileId) ||
        state.currentAvatarFallbackUrl;
    dom.avatarPreviewEl.src = src || EMPTY_AVATAR_SRC;
}

export function setProfileMessage(dom: MePageDom, message: string): void {
    if (dom.profileMsg) {
        dom.profileMsg.textContent = message;
    }
}

export function setCropMessage(dom: MePageDom, message: string): void {
    if (dom.avatarCropMsg) {
        dom.avatarCropMsg.textContent = message;
    }
}

export function setUsernameEditing(
    dom: MePageDom,
    editing: boolean,
    focusInput = false,
): void {
    if (!dom.usernameDisplayBtn || !dom.usernameEditor) {
        return;
    }
    dom.usernameDisplayBtn.classList.toggle("hidden", editing);
    dom.usernameEditor.classList.toggle("hidden", !editing);
    if (editing && focusInput && dom.usernameInput) {
        window.requestAnimationFrame(() => {
            dom.usernameInput!.focus();
            const length = dom.usernameInput!.value.length;
            dom.usernameInput!.setSelectionRange(length, length);
        });
    }
}

export function setBioEditing(
    dom: MePageDom,
    editing: boolean,
    focusInput = false,
): void {
    if (!dom.bioDisplayBtn || !dom.bioEditor) {
        return;
    }
    dom.bioDisplayBtn.classList.toggle("hidden", editing);
    dom.bioEditor.classList.toggle("hidden", !editing);
    if (editing && focusInput && dom.bioInput) {
        window.requestAnimationFrame(() => {
            dom.bioInput!.focus();
            const length = dom.bioInput!.value.length;
            dom.bioInput!.setSelectionRange(length, length);
        });
    }
}

export function setDisplaynameEditing(
    dom: MePageDom,
    editing: boolean,
    focusInput = false,
): void {
    if (!dom.displaynameDisplayBtn || !dom.displaynameEditor) {
        return;
    }
    dom.displaynameDisplayBtn.classList.toggle("hidden", editing);
    dom.displaynameEditor.classList.toggle("hidden", !editing);
    if (editing && focusInput && dom.displaynameInput) {
        window.requestAnimationFrame(() => {
            dom.displaynameInput!.focus();
            const length = dom.displaynameInput!.value.length;
            dom.displaynameInput!.setSelectionRange(length, length);
        });
    }
}

export function updateUsernameCounter(dom: MePageDom): void {
    if (!dom.usernameInput || !dom.usernameCounter) {
        return;
    }
    const current = weightedCharLength(
        String(dom.usernameInput.value || "").trim(),
    );
    dom.usernameCounter.textContent = `${current}/${USERNAME_MAX_WEIGHT}`;
}

export function updateUsernameDisplay(dom: MePageDom): void {
    if (!dom.usernameDisplayText || !dom.usernameInput) {
        return;
    }
    const text = String(dom.usernameInput.value || "").trim();
    const hasValue = Boolean(text);
    dom.usernameDisplayText.textContent = hasValue
        ? text
        : t(I18nKey.meSettingsUsernameClickEdit);
    dom.usernameDisplayText.classList.toggle("text-60", !hasValue);
}

export function updateBioCounter(dom: MePageDom): void {
    if (!dom.bioInput || !dom.bioCounter) {
        return;
    }
    const current = weightedCharLength(String(dom.bioInput.value || ""));
    dom.bioCounter.textContent = `${current}/${PROFILE_BIO_MAX_LENGTH}`;
}

export function updateBioDisplay(dom: MePageDom): void {
    if (!dom.bioDisplayText || !dom.bioInput) {
        return;
    }
    const text = String(dom.bioInput.value || "").trim();
    const hasValue = Boolean(text);
    dom.bioDisplayText.textContent = hasValue
        ? text
        : t(I18nKey.meSettingsBioClickEdit);
    dom.bioDisplayText.classList.toggle("text-60", !hasValue);
}

export function updateDisplaynameCounter(dom: MePageDom): void {
    if (!dom.displaynameInput || !dom.displaynameCounter) {
        return;
    }
    const current = weightedCharLength(
        String(dom.displaynameInput.value || "").trim(),
    );
    dom.displaynameCounter.textContent = `${current}/${DISPLAY_NAME_MAX_WEIGHT}`;
}

export function updateDisplaynameDisplay(dom: MePageDom): void {
    if (!dom.displaynameDisplayText || !dom.displaynameInput) {
        return;
    }
    const text = String(dom.displaynameInput.value || "").trim();
    const hasValue = Boolean(text);
    dom.displaynameDisplayText.textContent = hasValue
        ? text
        : t(I18nKey.meSettingsDisplayNameClickEdit);
    dom.displaynameDisplayText.classList.toggle("text-60", !hasValue);
}

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

export function validateUsernameInput(dom: MePageDom): string | null {
    if (!dom.usernameInput) {
        return null;
    }
    const raw = String(dom.usernameInput.value || "").trim();
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
}

export function validateDisplaynameInput(dom: MePageDom): string | null {
    if (!dom.displaynameInput) {
        return null;
    }
    const raw = String(dom.displaynameInput.value || "").trim();
    if (!raw) {
        return t(I18nKey.meSettingsDisplayNameRequired);
    }
    if (weightedCharLength(raw) > DISPLAY_NAME_MAX_WEIGHT) {
        return t(I18nKey.meSettingsDisplayNameTooLong);
    }
    return null;
}

export function validateBioInput(dom: MePageDom): string | null {
    if (!dom.bioInput) {
        return null;
    }
    if (
        weightedCharLength(String(dom.bioInput.value || "")) >
        PROFILE_BIO_MAX_LENGTH
    ) {
        return t(I18nKey.meSettingsBioTooLong);
    }
    return null;
}

// ---------------------------------------------------------------------------
// 外部点击折叠与输入控件绑定详见 me-page-profile-dom-bind.ts
// ---------------------------------------------------------------------------
