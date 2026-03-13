/**
 * /me/ 账户设置页：头像控件事件绑定。
 *
 * 从 me-page-avatar.ts 拆离，以将单文件行数保持在 ESLint 限制以内。
 */

import { DATA_BOUND, AVATAR_CROP_ZOOM_MIN } from "@/scripts/me-page-types";
import type { MePageDom, MePageState } from "@/scripts/me-page-types";
import {
    openAvatarCropModal,
    closeAvatarCropModal,
    loadAvatarCropFile,
    applyAvatarFromCrop,
    setAvatarCropScaleFromZoom,
    renderAvatarCropImage,
} from "@/scripts/me-page-avatar";
import {
    updateAvatarPreview,
    clearPendingAvatarUpload,
    setProfileMessage,
    checkProfileDirty,
} from "@/scripts/me-page-profile-dom";

// ---------------------------------------------------------------------------
// 头像控件事件绑定
// ---------------------------------------------------------------------------

export function bindAvatarControls(dom: MePageDom, state: MePageState): void {
    bindAvatarUploadAndCropButtons(dom, state);
    bindAvatarCropViewport(dom, state);
    bindAvatarClearBtn(dom, state);
}

function bindAvatarUploadAndCropButtons(
    dom: MePageDom,
    state: MePageState,
): void {
    if (dom.avatarUploadBtn && !dom.avatarUploadBtn.hasAttribute(DATA_BOUND)) {
        dom.avatarUploadBtn.setAttribute(DATA_BOUND, "");
        dom.avatarUploadBtn.addEventListener("click", () => {
            openAvatarCropModal(dom);
            setProfileMessage(dom, "");
        });
    }

    if (
        dom.avatarCropSelectBtn &&
        !dom.avatarCropSelectBtn.hasAttribute(DATA_BOUND)
    ) {
        dom.avatarCropSelectBtn.setAttribute(DATA_BOUND, "");
        dom.avatarCropSelectBtn.addEventListener("click", () => {
            dom.avatarCropFileInput?.click();
        });
    }

    if (
        dom.avatarCropFileInput &&
        !dom.avatarCropFileInput.hasAttribute(DATA_BOUND)
    ) {
        dom.avatarCropFileInput.setAttribute(DATA_BOUND, "");
        dom.avatarCropFileInput.addEventListener("change", () => {
            const file = dom.avatarCropFileInput!.files?.[0];
            if (file) {
                loadAvatarCropFile(dom, state, file);
            }
        });
    }

    if (
        dom.avatarCropZoomInput &&
        !dom.avatarCropZoomInput.hasAttribute(DATA_BOUND)
    ) {
        dom.avatarCropZoomInput.setAttribute(DATA_BOUND, "");
        dom.avatarCropZoomInput.addEventListener("input", () => {
            const zoom = Number.parseFloat(
                dom.avatarCropZoomInput!.value || String(AVATAR_CROP_ZOOM_MIN),
            );
            const anchor =
                state.avatarCropViewportSize > 0
                    ? state.avatarCropViewportSize / 2
                    : 0;
            setAvatarCropScaleFromZoom(dom, state, zoom, anchor, anchor);
        });
    }

    if (
        dom.avatarCropApplyBtn &&
        !dom.avatarCropApplyBtn.hasAttribute(DATA_BOUND)
    ) {
        dom.avatarCropApplyBtn.setAttribute(DATA_BOUND, "");
        dom.avatarCropApplyBtn.addEventListener("click", () => {
            void applyAvatarFromCrop(dom, state);
        });
    }

    if (
        dom.avatarCropCancelBtn &&
        !dom.avatarCropCancelBtn.hasAttribute(DATA_BOUND)
    ) {
        dom.avatarCropCancelBtn.setAttribute(DATA_BOUND, "");
        dom.avatarCropCancelBtn.addEventListener("click", () => {
            if (!state.avatarUploading) {
                closeAvatarCropModal(dom, state);
            }
        });
    }

    if (dom.avatarCropModal && !dom.avatarCropModal.hasAttribute(DATA_BOUND)) {
        dom.avatarCropModal.setAttribute(DATA_BOUND, "");
        dom.avatarCropModal.addEventListener("click", (event: MouseEvent) => {
            if (
                !state.avatarUploading &&
                event.target === dom.avatarCropModal
            ) {
                closeAvatarCropModal(dom, state);
            }
        });
        dom.avatarCropModal.addEventListener(
            "keydown",
            (event: KeyboardEvent) => {
                if (event.key === "Escape" && !state.avatarUploading) {
                    closeAvatarCropModal(dom, state);
                }
            },
        );
    }
}

export function bindAvatarCropViewport(
    dom: MePageDom,
    state: MePageState,
): void {
    if (
        !dom.avatarCropViewport ||
        dom.avatarCropViewport.hasAttribute(DATA_BOUND)
    ) {
        return;
    }
    dom.avatarCropViewport.setAttribute(DATA_BOUND, "");

    dom.avatarCropViewport.addEventListener(
        "pointerdown",
        (event: PointerEvent) => {
            if (!state.avatarCropLoaded || !dom.avatarCropViewport) {
                return;
            }
            state.avatarCropPointerId = event.pointerId;
            state.avatarCropPointerX = event.clientX;
            state.avatarCropPointerY = event.clientY;
            dom.avatarCropViewport.setPointerCapture(event.pointerId);
            event.preventDefault();
        },
    );

    dom.avatarCropViewport.addEventListener(
        "pointermove",
        (event: PointerEvent) => {
            if (
                !state.avatarCropLoaded ||
                state.avatarCropPointerId !== event.pointerId
            ) {
                return;
            }
            const deltaX = event.clientX - state.avatarCropPointerX;
            const deltaY = event.clientY - state.avatarCropPointerY;
            state.avatarCropPointerX = event.clientX;
            state.avatarCropPointerY = event.clientY;
            state.avatarCropOffsetX += deltaX;
            state.avatarCropOffsetY += deltaY;
            renderAvatarCropImage(dom, state);
            event.preventDefault();
        },
    );

    const releasePointer = (event: PointerEvent): void => {
        if (
            state.avatarCropPointerId !== event.pointerId ||
            !dom.avatarCropViewport
        ) {
            return;
        }
        if (dom.avatarCropViewport.hasPointerCapture(event.pointerId)) {
            dom.avatarCropViewport.releasePointerCapture(event.pointerId);
        }
        state.avatarCropPointerId = null;
    };
    dom.avatarCropViewport.addEventListener("pointerup", releasePointer);
    dom.avatarCropViewport.addEventListener("pointercancel", releasePointer);
}

function bindAvatarClearBtn(dom: MePageDom, state: MePageState): void {
    if (dom.avatarClearBtn && !dom.avatarClearBtn.hasAttribute(DATA_BOUND)) {
        dom.avatarClearBtn.setAttribute(DATA_BOUND, "");
        dom.avatarClearBtn.addEventListener("click", () => {
            clearPendingAvatarUpload(state, true);
            state.currentAvatarFileId = "";
            state.currentAvatarFallbackUrl = "";
            if (dom.avatarCropFileInput) {
                dom.avatarCropFileInput.value = "";
            }
            updateAvatarPreview(dom, state);
            checkProfileDirty(dom, state);
        });
    }
}
