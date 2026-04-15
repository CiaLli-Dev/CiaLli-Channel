/**
 * /me/ 账户设置页辅助入口。
 *
 * 仅保留 填充/提交/初始化 等页面级逻辑，
 * 其余 类型/常量/DOM/头像/社交 均从子模块引入并再导出，
 * 以将本文件行数控制在 ESLint max-lines 限制以内。
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/shared/i18n-runtime";
import { runWithTask } from "@/scripts/shared/progress-overlay-manager";
import type { ProgressTaskHandle } from "@/scripts/shared/progress-overlay-manager";
import { showConfirmDialog, showNoticeDialog } from "@/scripts/shared/dialogs";
import {
    getApiErrorMessage,
    requestApi as api,
} from "@/scripts/shared/http-client";
import type { ApiResult } from "@/scripts/shared/http-client";
import {
    AUTH_ME_RETRY_DELAY_MS,
    DATA_BOUND,
    PRIVACY_CHECKBOX_IDS,
} from "@/scripts/me/page-types";
import type {
    MePageDom,
    MePageState,
    SocialLink,
} from "@/scripts/me/page-types";
import {
    buildLoginRedirectHref,
    extractFileId,
} from "@/scripts/shared/dom-helpers";
import {
    updateUsernameCounter,
    updateUsernameDisplay,
    setUsernameEditing,
    updateDisplaynameCounter,
    updateDisplaynameDisplay,
    setDisplaynameEditing,
    updateBioCounter,
    updateBioDisplay,
    setBioEditing,
    updateAvatarPreview,
    captureProfileSnapshot,
    capturePrivacySnapshot,
    clearPendingAvatarUpload,
    checkPrivacyDirty,
    setProfileMessage,
    validateUsernameInput,
    validateDisplaynameInput,
    validateBioInput,
} from "@/scripts/me/page-profile-dom";
import { uploadPendingAvatarIfNeeded } from "@/scripts/me/page-avatar";
import { fillSocialLinks } from "@/scripts/me/page-social";

export type { ProgressTaskHandle, ApiResult };

// ---------------------------------------------------------------------------
// 从子模块再导出，保持 me-page.ts 的导入路径不变
// ---------------------------------------------------------------------------

export {
    DATA_BOUND,
    AUTH_ME_RETRY_DELAY_MS,
    PRIVACY_CHECKBOX_IDS,
    OUTSIDE_CLICK_KEY,
} from "@/scripts/me/page-types";
export type {
    MePageDom,
    MePageState,
    SocialLink,
    RuntimeWindow,
} from "@/scripts/me/page-types";
export { createInitialState } from "@/scripts/me/page-types";
export {
    queryDom,
    captureProfileSnapshot,
    capturePrivacySnapshot,
    clearPendingAvatarUpload,
    updateAvatarPreview,
    setProfileMessage,
    setCropMessage,
    setUsernameEditing,
    setBioEditing,
    setDisplaynameEditing,
    updateUsernameCounter,
    updateUsernameDisplay,
    updateBioCounter,
    updateBioDisplay,
    updateDisplaynameCounter,
    updateDisplaynameDisplay,
    validateUsernameInput,
    validateDisplaynameInput,
    validateBioInput,
    checkProfileDirty,
    checkPrivacyDirty,
} from "@/scripts/me/page-profile-dom";
export {
    buildOutsideClickHandler,
    bindAllInputControls,
    bindEditToggleButtons,
} from "@/scripts/me/page-profile-dom-bind";
export {
    resetAvatarCropState,
    uploadPendingAvatarIfNeeded,
} from "@/scripts/me/page-avatar";
export {
    bindAvatarControls,
    bindAvatarCropViewport,
} from "@/scripts/me/page-avatar-bind";
export {
    fillSocialLinks,
    collectSocialLinks,
    bindSocialSaveBtn,
} from "@/scripts/me/page-social";

// ---------------------------------------------------------------------------
// fillProfile 内部子函数（降低 fillProfile 圈复杂度）
// ---------------------------------------------------------------------------

function fillBasicInfo(
    dom: MePageDom,
    profile: Record<string, unknown> | null | undefined,
): void {
    if (dom.usernameInput) {
        dom.usernameInput.value = (profile?.username as string) || "";
        updateUsernameCounter(dom);
        updateUsernameDisplay(dom);
        setUsernameEditing(dom, false);
    }
    if (dom.displaynameInput) {
        dom.displaynameInput.value = (profile?.display_name as string) || "";
        updateDisplaynameCounter(dom);
        updateDisplaynameDisplay(dom);
        setDisplaynameEditing(dom, false);
    }
}

function fillBioInfo(
    dom: MePageDom,
    profile: Record<string, unknown> | null | undefined,
): void {
    if (dom.bioInput) {
        dom.bioInput.value = (profile?.bio as string) || "";
        updateBioCounter(dom);
        updateBioDisplay(dom);
        setBioEditing(dom, false);
    }
}

function fillAvatarInfo(
    dom: MePageDom,
    state: MePageState,
    profile: Record<string, unknown> | null | undefined,
    fallbackAvatarUrl: string,
): void {
    state.currentAvatarFileId = extractFileId(profile?.avatar_file);
    state.currentAvatarFallbackUrl = String(fallbackAvatarUrl || "").trim();
    updateAvatarPreview(dom, state);
}

// ---------------------------------------------------------------------------
// fillProfile：填充资料表单
// ---------------------------------------------------------------------------

export function fillProfile(
    dom: MePageDom,
    state: MePageState,
    profile: Record<string, unknown> | null | undefined,
    fallbackAvatarUrl = "",
): void {
    clearPendingAvatarUpload(state, true);
    fillBasicInfo(dom, profile);
    fillAvatarInfo(dom, state, profile, fallbackAvatarUrl);
    fillBioInfo(dom, profile);
    fillSocialLinks(
        dom.socialLinksList,
        Array.isArray(profile?.social_links)
            ? (profile.social_links as SocialLink[])
            : null,
    );
    state.profileSnapshot = captureProfileSnapshot(dom, state);
}

// ---------------------------------------------------------------------------
// fillPrivacy：填充隐私表单
// ---------------------------------------------------------------------------

export function fillPrivacy(
    state: MePageState,
    privacy: Record<string, unknown> | null | undefined,
): void {
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
    state.privacySnapshot = capturePrivacySnapshot();
}

// ---------------------------------------------------------------------------
// API 辅助
// ---------------------------------------------------------------------------

export async function loadAuthMe(): Promise<ApiResult> {
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
}

export async function runInit(
    dom: MePageDom,
    state: MePageState,
): Promise<void> {
    dom.authenticatedSections.classList.add("hidden");
    const me = await loadAuthMe();
    if (!me.response.ok || !me.data?.ok) {
        window.location.href = buildLoginRedirectHref();
        return;
    }
    const loginEmail = String(
        (me.data.user as Record<string, unknown> | undefined)?.email || "",
    ).trim();
    state.currentLoginEmail = loginEmail;
    const fallbackAvatarUrl = String(
        (me.data.user as Record<string, unknown> | undefined)?.avatarUrl || "",
    ).trim();
    if (dom.emailInput) {
        dom.emailInput.value = loginEmail;
    }
    state.currentAvatarFallbackUrl = fallbackAvatarUrl;
    updateAvatarPreview(dom, state);

    const [profileResp, privacyResp] = await Promise.all([
        api("/api/v1/me/profile"),
        api("/api/v1/me/privacy"),
    ]);
    if (profileResp.response.ok && profileResp.data?.ok) {
        fillProfile(
            dom,
            state,
            profileResp.data.profile as Record<string, unknown> | undefined,
            fallbackAvatarUrl,
        );
    }
    if (privacyResp.response.ok && privacyResp.data?.ok) {
        fillPrivacy(
            state,
            privacyResp.data.privacy as Record<string, unknown> | undefined,
        );
    }
    dom.authenticatedSections.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// submitProfilePayload 内部子函数（降低圈复杂度）
// ---------------------------------------------------------------------------

function buildProfilePayload(
    dom: MePageDom,
    state: MePageState,
): Record<string, unknown> {
    return {
        username: dom.usernameInput ? dom.usernameInput.value : "",
        display_name: dom.displaynameInput ? dom.displaynameInput.value : "",
        bio: dom.bioInput ? dom.bioInput.value : "",
        avatar_file: state.currentAvatarFileId || null,
    };
}

async function saveProfileApi(
    dom: MePageDom,
    state: MePageState,
    update: (opts: { text: string }) => void,
): Promise<void> {
    const payload = buildProfilePayload(dom, state);
    const { response, data } = await api("/api/v1/me/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
    });
    if (!response.ok || !data?.ok) {
        setProfileMessage(
            dom,
            getApiErrorMessage(data, t(I18nKey.interactionCommonSaveFailed)),
        );
        return;
    }
    update({ text: t(I18nKey.interactionCommonSaveCompletedReloading) });
    setProfileMessage(dom, t(I18nKey.interactionCommonSavedReloading));
    window.setTimeout(() => {
        window.location.reload();
    }, 120);
}

async function submitProfilePayload(
    dom: MePageDom,
    state: MePageState,
    handle: ProgressTaskHandle,
    update: (opts: { text: string }) => void,
): Promise<void> {
    const avatarUploaded = await uploadPendingAvatarIfNeeded(
        dom,
        state,
        handle,
    );
    if (!avatarUploaded) {
        return;
    }
    update({ text: t(I18nKey.meSettingsSavingProfileSubmitting) });
    await saveProfileApi(dom, state, update);
}

// ---------------------------------------------------------------------------
// bindProfileForm：绑定资料表单提交
// ---------------------------------------------------------------------------

export function bindProfileForm(dom: MePageDom, state: MePageState): void {
    const profileForm = document.getElementById("me-profile-form");
    if (!profileForm || profileForm.hasAttribute(DATA_BOUND)) {
        return;
    }
    profileForm.setAttribute(DATA_BOUND, "");
    profileForm.addEventListener("submit", (event: Event) => {
        void handleProfileFormSubmit(event, dom, state);
    });
}

async function handleProfileFormSubmit(
    event: Event,
    dom: MePageDom,
    state: MePageState,
): Promise<void> {
    event.preventDefault();
    const usernameError = validateUsernameInput(dom);
    if (usernameError) {
        setProfileMessage(dom, usernameError);
        return;
    }
    const displaynameError = validateDisplaynameInput(dom);
    if (displaynameError) {
        setProfileMessage(dom, displaynameError);
        return;
    }
    const bioError = validateBioInput(dom);
    if (bioError) {
        setProfileMessage(dom, bioError);
        return;
    }
    await runWithTask(
        {
            title: t(I18nKey.meSettingsSavingProfileTitle),
            mode: "indeterminate",
            text: t(I18nKey.meSettingsSavingProfileText),
        },
        async ({ handle, update }) => {
            await submitProfilePayload(dom, state, handle, update);
        },
    );
}

// ---------------------------------------------------------------------------
// bindPrivacyForm：绑定隐私表单提交
// ---------------------------------------------------------------------------

export function bindPrivacyForm(dom: MePageDom, state: MePageState): void {
    for (const [elId] of PRIVACY_CHECKBOX_IDS) {
        const el = document.getElementById(elId) as HTMLInputElement | null;
        if (el && !el.hasAttribute(DATA_BOUND)) {
            el.setAttribute(DATA_BOUND, "");
            el.addEventListener("change", () => checkPrivacyDirty(dom, state));
        }
    }

    const privacyForm = document.getElementById("me-privacy-form");
    if (!privacyForm || privacyForm.hasAttribute(DATA_BOUND)) {
        return;
    }
    privacyForm.setAttribute(DATA_BOUND, "");
    privacyForm.addEventListener("submit", (event: Event) => {
        void handlePrivacyFormSubmit(event, dom, state);
    });
}

async function handlePrivacyFormSubmit(
    event: Event,
    dom: MePageDom,
    state: MePageState,
): Promise<void> {
    event.preventDefault();
    const privacyIds: [string, string][] = [
        ["pv-profile-public", "profile_public"],
        ["pv-show-articles", "show_articles_on_profile"],
        ["pv-show-diaries", "show_diaries_on_profile"],
        ["pv-show-albums", "show_albums_on_profile"],
        ["pv-show-comments", "show_comments_on_profile"],
    ];
    const payload: Record<string, boolean> = {};
    for (const [elId, key] of privacyIds) {
        const el = document.getElementById(elId) as HTMLInputElement | null;
        payload[key] = el?.checked ?? false;
    }
    await runWithTask(
        {
            title: t(I18nKey.meSettingsSavingPrivacyTitle),
            mode: "indeterminate",
            text: t(I18nKey.interactionCommonSaving),
        },
        async ({ update }) => {
            const { response, data } = await api("/api/v1/me/privacy", {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            if (!dom.privacyMsg) {
                return;
            }
            if (response.ok && data?.ok) {
                update({
                    text: t(I18nKey.interactionCommonSaveCompletedReloading),
                });
                state.privacySnapshot = capturePrivacySnapshot();
                dom.privacyMsg.textContent = t(
                    I18nKey.interactionCommonSavedReloading,
                );
                window.setTimeout(() => {
                    window.location.reload();
                }, 120);
                return;
            }
            dom.privacyMsg.textContent = getApiErrorMessage(
                data,
                t(I18nKey.interactionCommonSaveFailed),
            );
        },
    );
}

// ---------------------------------------------------------------------------
// bindLogoutAction：绑定退出登录动作
// ---------------------------------------------------------------------------

export function bindLogoutAction(dom: MePageDom): void {
    const { logoutBtn } = dom;
    if (!logoutBtn || logoutBtn.hasAttribute(DATA_BOUND)) {
        return;
    }

    logoutBtn.setAttribute(DATA_BOUND, "");
    logoutBtn.addEventListener("click", () => {
        void handleLogoutAction(logoutBtn);
    });
}

async function handleLogoutAction(logoutBtn: HTMLButtonElement): Promise<void> {
    const confirmed = await showConfirmDialog({
        ariaLabel: t(I18nKey.meSettingsLogoutConfirmTitle),
        message: t(I18nKey.meSettingsLogoutConfirmMessage),
        confirmText: t(I18nKey.meSettingsLogoutButton),
        cancelText: t(I18nKey.interactionCommonCancel),
        confirmVariant: "danger",
    });
    if (!confirmed) {
        return;
    }

    logoutBtn.disabled = true;
    try {
        const { response, data } = await api("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({}),
        });
        if (!response.ok || !data?.ok) {
            await showNoticeDialog({
                ariaLabel: t(I18nKey.meSettingsLogoutFailedTitle),
                message: getApiErrorMessage(
                    data,
                    t(I18nKey.meSettingsLogoutFailedMessage),
                ),
            });
            return;
        }
        window.location.href = "/";
    } catch (error) {
        console.error("[me-page] logout failed", error);
        await showNoticeDialog({
            ariaLabel: t(I18nKey.meSettingsLogoutFailedTitle),
            message: t(I18nKey.meSettingsLogoutFailedMessage),
        });
    } finally {
        logoutBtn.disabled = false;
    }
}
