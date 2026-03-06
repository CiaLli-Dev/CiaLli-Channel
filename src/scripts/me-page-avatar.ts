/**
 * /me/ 账户设置页：头像裁剪、上传相关逻辑。
 */

import I18nKey from "@/i18n/i18nKey";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { updateTask } from "@/scripts/progress-overlay-manager";
import type { ProgressTaskHandle } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import type { ApiResult } from "@/scripts/http-client";
import { clamp } from "@/scripts/dom-helpers";
import {
    AVATAR_CROP_OUTPUT_SIZE,
    AVATAR_CROP_ZOOM_MIN,
    AVATAR_CROP_ZOOM_MAX,
} from "@/scripts/me-page-types";
import type { MePageDom, MePageState } from "@/scripts/me-page-types";
import {
    clearPendingAvatarUpload,
    updateAvatarPreview,
    setProfileMessage,
    setCropMessage,
    checkProfileDirty,
} from "@/scripts/me-page-profile-dom";

export type { ApiResult, ProgressTaskHandle };

// ---------------------------------------------------------------------------
// 头像裁剪状态操作
// ---------------------------------------------------------------------------

export function toSafeFileLabel(value: string): string {
    return String(value || "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ");
}

export function measureAvatarCropViewportSize(
    avatarCropViewport: HTMLElement | null,
): number {
    if (!avatarCropViewport) {
        return 0;
    }
    const rect = avatarCropViewport.getBoundingClientRect();
    return Math.max(0, Math.floor(Math.min(rect.width, rect.height)));
}

export function buildAvatarCropBlob(
    state: MePageState,
    avatarCropImage: HTMLImageElement | null,
): Promise<Blob | null> {
    if (!state.avatarCropLoaded || !avatarCropImage) {
        return Promise.resolve(null);
    }
    if (state.avatarCropViewportSize <= 0) {
        return Promise.resolve(null);
    }
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_CROP_OUTPUT_SIZE;
    canvas.height = AVATAR_CROP_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
        return Promise.resolve(null);
    }
    const ratio = AVATAR_CROP_OUTPUT_SIZE / state.avatarCropViewportSize;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        avatarCropImage,
        state.avatarCropOffsetX * ratio,
        state.avatarCropOffsetY * ratio,
        state.avatarCropImageWidth * state.avatarCropScale * ratio,
        state.avatarCropImageHeight * state.avatarCropScale * ratio,
    );
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
}

function revokeAvatarCropObjectUrl(state: MePageState): void {
    if (state.avatarCropObjectUrl) {
        URL.revokeObjectURL(state.avatarCropObjectUrl);
        state.avatarCropObjectUrl = "";
    }
}

function setAvatarCropEmptyVisible(dom: MePageDom, visible: boolean): void {
    if (dom.avatarCropEmpty) {
        dom.avatarCropEmpty.classList.toggle("hidden", !visible);
    }
}

export function updateAvatarCropApplyState(
    dom: MePageDom,
    state: MePageState,
): void {
    if (dom.avatarCropApplyBtn) {
        dom.avatarCropApplyBtn.disabled =
            !state.avatarCropLoaded || state.avatarUploading;
        dom.avatarCropApplyBtn.textContent = state.avatarUploading
            ? t(I18nKey.interactionCommonUploading)
            : t(I18nKey.interactionCommonApplyCrop);
    }
}

function clampAvatarCropOffset(state: MePageState): void {
    if (!state.avatarCropLoaded || state.avatarCropViewportSize <= 0) {
        return;
    }
    const scaledWidth = state.avatarCropImageWidth * state.avatarCropScale;
    const scaledHeight = state.avatarCropImageHeight * state.avatarCropScale;
    const minX = state.avatarCropViewportSize - scaledWidth;
    const minY = state.avatarCropViewportSize - scaledHeight;
    state.avatarCropOffsetX = clamp(state.avatarCropOffsetX, minX, 0);
    state.avatarCropOffsetY = clamp(state.avatarCropOffsetY, minY, 0);
}

export function renderAvatarCropImage(
    dom: MePageDom,
    state: MePageState,
): void {
    if (!dom.avatarCropImage) {
        return;
    }
    if (!state.avatarCropLoaded) {
        dom.avatarCropImage.classList.add("hidden");
        setAvatarCropEmptyVisible(dom, true);
        return;
    }
    clampAvatarCropOffset(state);
    dom.avatarCropImage.classList.remove("hidden");
    dom.avatarCropImage.style.width = `${state.avatarCropImageWidth}px`;
    dom.avatarCropImage.style.height = `${state.avatarCropImageHeight}px`;
    dom.avatarCropImage.style.transformOrigin = "top left";
    dom.avatarCropImage.style.transform = `translate3d(${state.avatarCropOffsetX}px, ${state.avatarCropOffsetY}px, 0) scale(${state.avatarCropScale})`;
    setAvatarCropEmptyVisible(dom, false);
}

export function setAvatarCropScaleFromZoom(
    dom: MePageDom,
    state: MePageState,
    zoomPercent: number,
    anchorX: number,
    anchorY: number,
): void {
    if (!state.avatarCropLoaded || state.avatarCropViewportSize <= 0) {
        return;
    }
    const normalizedZoom = clamp(
        Number.isFinite(zoomPercent) ? zoomPercent : AVATAR_CROP_ZOOM_MIN,
        AVATAR_CROP_ZOOM_MIN,
        AVATAR_CROP_ZOOM_MAX,
    );
    const nextScale = state.avatarCropMinScale * (normalizedZoom / 100);
    const safeAnchorX = clamp(anchorX, 0, state.avatarCropViewportSize);
    const safeAnchorY = clamp(anchorY, 0, state.avatarCropViewportSize);
    const imagePointX =
        (safeAnchorX - state.avatarCropOffsetX) / state.avatarCropScale;
    const imagePointY =
        (safeAnchorY - state.avatarCropOffsetY) / state.avatarCropScale;
    state.avatarCropScale = nextScale;
    state.avatarCropOffsetX = safeAnchorX - imagePointX * state.avatarCropScale;
    state.avatarCropOffsetY = safeAnchorY - imagePointY * state.avatarCropScale;
    clampAvatarCropOffset(state);
    renderAvatarCropImage(dom, state);
    if (dom.avatarCropZoomInput) {
        dom.avatarCropZoomInput.value = String(Math.round(normalizedZoom));
    }
}

export function resetAvatarCropState(dom: MePageDom, state: MePageState): void {
    revokeAvatarCropObjectUrl(state);
    state.avatarCropLoaded = false;
    state.avatarCropImageWidth = 0;
    state.avatarCropImageHeight = 0;
    state.avatarCropViewportSize = 0;
    state.avatarCropMinScale = 1;
    state.avatarCropScale = 1;
    state.avatarCropOffsetX = 0;
    state.avatarCropOffsetY = 0;
    state.avatarCropPointerId = null;
    state.avatarCropPointerX = 0;
    state.avatarCropPointerY = 0;
    if (dom.avatarCropImage) {
        dom.avatarCropImage.removeAttribute("src");
        dom.avatarCropImage.classList.add("hidden");
        dom.avatarCropImage.style.transform = "";
        dom.avatarCropImage.style.width = "";
        dom.avatarCropImage.style.height = "";
        dom.avatarCropImage.style.transformOrigin = "top left";
    }
    if (dom.avatarCropZoomInput) {
        dom.avatarCropZoomInput.value = String(AVATAR_CROP_ZOOM_MIN);
    }
    setAvatarCropEmptyVisible(dom, true);
    updateAvatarCropApplyState(dom, state);
}

export function openAvatarCropModal(dom: MePageDom): void {
    if (!dom.avatarCropModal) {
        if (dom.profileMsg) {
            dom.profileMsg.textContent = t(I18nKey.meSettingsCropInitFailed);
        }
        return;
    }
    dom.avatarCropModal.classList.remove("hidden");
    dom.avatarCropModal.classList.add("flex");
    document.body.classList.add("overflow-hidden");
    dom.avatarCropModal.focus();
}

export function closeAvatarCropModal(dom: MePageDom, state: MePageState): void {
    if (!dom.avatarCropModal) {
        return;
    }
    dom.avatarCropModal.classList.remove("flex");
    dom.avatarCropModal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    if (dom.avatarCropFileInput) {
        dom.avatarCropFileInput.value = "";
    }
    resetAvatarCropState(dom, state);
    state.avatarUploading = false;
    updateAvatarCropApplyState(dom, state);
    setCropMessage(dom, "");
}

export function loadAvatarCropFile(
    dom: MePageDom,
    state: MePageState,
    file: File,
): void {
    if (!dom.avatarCropImage) {
        setCropMessage(dom, t(I18nKey.meSettingsCropInitFailed));
        return;
    }
    if (!file.type.startsWith("image/")) {
        setCropMessage(dom, t(I18nKey.interactionCommonSelectImage));
        return;
    }
    if (file.size > UPLOAD_LIMITS.avatar) {
        setCropMessage(
            dom,
            tFmt(I18nKey.interactionCommonImageTooLarge, {
                size: UPLOAD_LIMIT_LABELS.avatar,
            }),
        );
        return;
    }
    setCropMessage(dom, "");
    const nextObjectUrl = URL.createObjectURL(file);
    const img = dom.avatarCropImage;
    img.onload = () => {
        state.avatarCropLoaded = true;
        state.avatarCropImageWidth = Math.max(1, img.naturalWidth);
        state.avatarCropImageHeight = Math.max(1, img.naturalHeight);
        state.avatarCropViewportSize = measureAvatarCropViewportSize(
            dom.avatarCropViewport,
        );
        if (state.avatarCropViewportSize <= 0) {
            state.avatarCropViewportSize = 320;
        }
        state.avatarCropMinScale = Math.max(
            state.avatarCropViewportSize / state.avatarCropImageWidth,
            state.avatarCropViewportSize / state.avatarCropImageHeight,
        );
        state.avatarCropScale = state.avatarCropMinScale;
        state.avatarCropOffsetX =
            (state.avatarCropViewportSize -
                state.avatarCropImageWidth * state.avatarCropScale) /
            2;
        state.avatarCropOffsetY =
            (state.avatarCropViewportSize -
                state.avatarCropImageHeight * state.avatarCropScale) /
            2;
        if (dom.avatarCropZoomInput) {
            dom.avatarCropZoomInput.value = String(AVATAR_CROP_ZOOM_MIN);
        }
        renderAvatarCropImage(dom, state);
        updateAvatarCropApplyState(dom, state);
        setProfileMessage(dom, "");
    };
    img.onerror = () => {
        setCropMessage(dom, t(I18nKey.interactionCommonImageReadFailed));
        resetAvatarCropState(dom, state);
    };
    revokeAvatarCropObjectUrl(state);
    state.avatarCropObjectUrl = nextObjectUrl;
    img.src = nextObjectUrl;
}

export async function applyAvatarFromCrop(
    dom: MePageDom,
    state: MePageState,
): Promise<void> {
    if (!state.avatarCropLoaded) {
        setCropMessage(dom, t(I18nKey.meSettingsAvatarSelectFirst));
        return;
    }
    state.avatarUploading = true;
    updateAvatarCropApplyState(dom, state);
    try {
        const croppedBlob = await buildAvatarCropBlob(
            state,
            dom.avatarCropImage,
        );
        if (!croppedBlob) {
            setCropMessage(dom, t(I18nKey.meSettingsAvatarCropFailed));
            return;
        }
        clearPendingAvatarUpload(state, true);
        state.pendingAvatarUpload = {
            blob: croppedBlob,
            previewUrl: URL.createObjectURL(croppedBlob),
        };
        state.currentAvatarFileId = "";
        state.currentAvatarFallbackUrl = "";
        updateAvatarPreview(dom, state);
        closeAvatarCropModal(dom, state);
        checkProfileDirty(dom, state);
    } finally {
        state.avatarUploading = false;
        updateAvatarCropApplyState(dom, state);
    }
}

export async function uploadPendingAvatarIfNeeded(
    dom: MePageDom,
    state: MePageState,
    taskHandle?: ProgressTaskHandle,
): Promise<boolean> {
    if (!state.pendingAvatarUpload) {
        return true;
    }
    setProfileMessage(dom, t(I18nKey.meSettingsAvatarUploading));
    if (typeof taskHandle === "number") {
        updateTask(taskHandle, {
            text: t(I18nKey.meSettingsAvatarUploadingText),
        });
    }
    const formData = new FormData();
    const avatarTitleBase = `Avatar-${toSafeFileLabel(state.currentLoginEmail || "unknown")}`;
    formData.append(
        "file",
        state.pendingAvatarUpload.blob,
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
            dom,
            getApiErrorMessage(data, t(I18nKey.meSettingsAvatarUploadFailed)),
        );
        return false;
    }
    clearPendingAvatarUpload(state, true);
    state.currentAvatarFileId = String(
        (data.file as Record<string, unknown>).id,
    );
    return true;
}

// ---------------------------------------------------------------------------
// 头像控件事件绑定详见 me-page-avatar-bind.ts
// ---------------------------------------------------------------------------
