/**
 * site-settings-page 的裁剪操作模块。
 *
 * 包含 Crop Modal 的 modal 操作、文件加载、缩放控制及所有事件绑定。
 * 类型定义与纯计算工具位于 site-settings-page-crop.ts。
 */

import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    DATA_BOUND,
    CROP_ZOOM_MIN,
    CROP_ZOOM_MAX,
    pendingCropBlobs,
} from "@/scripts/site-settings-page-editor";
import {
    applyCropViewportBounds,
    clampCropOffset,
    renderCropImage,
    buildCropBlobWithLimit,
    resetCropState,
    setCropMessage,
    updateCropApplyState,
    revokeCropObjectUrl,
} from "@/scripts/site-settings-page-crop";
import type {
    CropTarget,
    CropModalContext,
} from "@/scripts/site-settings-page-crop";

// ---------------------------------------------------------------------------
// measureCropViewport
// ---------------------------------------------------------------------------

function measureCropViewport(ctx: CropModalContext): void {
    const rect = ctx.cropViewport.getBoundingClientRect();
    ctx.state.cropViewportWidth = rect.width;
    ctx.state.cropViewportHeight = rect.height;
}

// ---------------------------------------------------------------------------
// openCropModal / closeCropModal
// ---------------------------------------------------------------------------

export function openCropModal(ctx: CropModalContext, target: CropTarget): void {
    const {
        state,
        cropTargets,
        cropViewport,
        cropModal,
        cropPanel,
        cropTitle,
        cropHelp,
    } = ctx;
    const config = cropTargets[target];
    if (!config?.container || !cropViewport) {
        return;
    }
    if (cropPanel) {
        cropPanel.classList.remove("max-w-xl", "max-w-2xl");
        cropPanel.classList.add(
            target === "favicon" ? "max-w-xl" : "max-w-2xl",
        );
    }
    state.activeCropTarget = target;
    if (cropTitle) {
        cropTitle.textContent = config.title;
    }
    if (cropHelp) {
        cropHelp.textContent = config.help;
    }
    cropViewport.style.aspectRatio = `${config.aspectWidth} / ${config.aspectHeight}`;
    applyCropViewportBounds(cropViewport, config);
    cropModal.classList.remove("hidden");
    cropModal.classList.add("flex");
    cropModal.focus();
    setCropMessage(ctx, "");
    resetCropState(ctx);
    if (!state.cropResizeHandlerBound) {
        window.addEventListener("resize", () => {
            if (!state.activeCropTarget) {
                return;
            }
            applyCropViewportBounds(
                cropViewport,
                cropTargets[state.activeCropTarget],
            );
            if (state.cropLoaded) {
                renderCropImage(ctx);
            }
        });
        state.cropResizeHandlerBound = true;
    }
}

export function closeCropModal(ctx: CropModalContext): void {
    const { state, cropModal, cropFileInput } = ctx;
    cropModal.classList.remove("flex");
    cropModal.classList.add("hidden");
    if (cropFileInput) {
        cropFileInput.value = "";
    }
    state.activeCropTarget = null;
    state.cropUploading = false;
    resetCropState(ctx);
    setCropMessage(ctx, "");
}

// ---------------------------------------------------------------------------
// setCropScaleFromZoom
// ---------------------------------------------------------------------------

export function setCropScaleFromZoom(
    ctx: CropModalContext,
    zoomValue: string,
    anchorX: number,
    anchorY: number,
): void {
    const { state, cropZoomInput } = ctx;
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return;
    }
    const normalizedZoom = Math.max(
        CROP_ZOOM_MIN,
        Math.min(
            CROP_ZOOM_MAX,
            Number.isFinite(Number(zoomValue))
                ? Number(zoomValue)
                : CROP_ZOOM_MIN,
        ),
    );
    const nextScale = state.cropMinScale * (normalizedZoom / 100);
    const safeAnchorX = Math.max(0, Math.min(state.cropViewportWidth, anchorX));
    const safeAnchorY = Math.max(
        0,
        Math.min(state.cropViewportHeight, anchorY),
    );
    const imagePointX = (safeAnchorX - state.cropOffsetX) / state.cropScale;
    const imagePointY = (safeAnchorY - state.cropOffsetY) / state.cropScale;
    state.cropScale = nextScale;
    state.cropOffsetX = safeAnchorX - imagePointX * state.cropScale;
    state.cropOffsetY = safeAnchorY - imagePointY * state.cropScale;
    clampCropOffset(state);
    renderCropImage(ctx);
    if (cropZoomInput) {
        cropZoomInput.value = String(Math.round(normalizedZoom));
    }
}

// ---------------------------------------------------------------------------
// loadCropFile
// ---------------------------------------------------------------------------

export function loadCropFile(ctx: CropModalContext, file: File): void {
    const { state, cropTargets, cropImage, cropZoomInput } = ctx;
    if (!file) {
        setCropMessage(ctx, t(I18nKey.adminSiteSettingsSelectImageFile));
        return;
    }
    const config = state.activeCropTarget
        ? cropTargets[state.activeCropTarget]
        : null;
    const maxBytes = config?.maxInputBytes ?? UPLOAD_LIMITS.general;
    const label = config?.purpose
        ? UPLOAD_LIMIT_LABELS[config.purpose]
        : UPLOAD_LIMIT_LABELS.general;
    if (file.size > maxBytes) {
        setCropMessage(
            ctx,
            tFmt(I18nKey.adminSiteSettingsImageTooLargeWithLimit, {
                limit: label,
            }),
        );
        return;
    }
    setCropMessage(ctx, "");
    const nextObjectUrl = URL.createObjectURL(file);
    const img = cropImage;
    img.onload = () => {
        state.cropLoaded = true;
        state.cropImageWidth = Math.max(1, img.naturalWidth);
        state.cropImageHeight = Math.max(1, img.naturalHeight);
        measureCropViewport(ctx);
        if (state.cropViewportWidth <= 0 || state.cropViewportHeight <= 0) {
            state.cropViewportWidth = 320;
            state.cropViewportHeight = 180;
        }
        state.cropMinScale = Math.max(
            state.cropViewportWidth / state.cropImageWidth,
            state.cropViewportHeight / state.cropImageHeight,
        );
        state.cropScale = state.cropMinScale;
        state.cropOffsetX =
            (state.cropViewportWidth - state.cropImageWidth * state.cropScale) /
            2;
        state.cropOffsetY =
            (state.cropViewportHeight -
                state.cropImageHeight * state.cropScale) /
            2;
        if (cropZoomInput) {
            cropZoomInput.value = String(CROP_ZOOM_MIN);
        }
        renderCropImage(ctx);
        updateCropApplyState(ctx);
    };
    img.onerror = () => {
        setCropMessage(ctx, t(I18nKey.interactionCommonImageReadFailed));
        resetCropState(ctx);
    };
    revokeCropObjectUrl(ctx);
    state.cropObjectUrl = nextObjectUrl;
    img.src = nextObjectUrl;
}

// ---------------------------------------------------------------------------
// confirmCrop
// ---------------------------------------------------------------------------

export async function confirmCrop(ctx: CropModalContext): Promise<void> {
    const { state, cropTargets, cropImage } = ctx;
    if (!state.activeCropTarget) {
        return;
    }
    const config = cropTargets[state.activeCropTarget];
    if (!config?.container || !state.cropLoaded) {
        setCropMessage(ctx, t(I18nKey.adminSiteSettingsSelectImageFile));
        return;
    }
    state.cropUploading = true;
    updateCropApplyState(ctx);
    try {
        const croppedBlob = await buildCropBlobWithLimit(
            state,
            cropImage,
            config.outputWidth,
            config.outputHeight,
            config.outputMimeType,
        );
        if (!croppedBlob) {
            setCropMessage(
                ctx,
                t(I18nKey.adminSiteSettingsCropFailedOrTooLarge),
            );
            return;
        }
        const blobUrl = URL.createObjectURL(croppedBlob);
        const row = config.createRow(blobUrl);
        pendingCropBlobs.set(row, {
            blob: croppedBlob,
            objectUrl: blobUrl,
            titlePrefix: config.titlePrefix,
            useSequentialName: config.useSequentialName,
            useFixedName: config.useFixedName,
            container: config.container,
            fileExt: config.outputFileExt,
            targetFormat:
                state.activeCropTarget === "favicon" ? "ico" : undefined,
            purpose: config.purpose,
        });
        config.container.appendChild(row);
        closeCropModal(ctx);
    } finally {
        state.cropUploading = false;
        updateCropApplyState(ctx);
    }
}

// ---------------------------------------------------------------------------
// 事件绑定
// ---------------------------------------------------------------------------

export function bindCropButtonEvents(
    ctx: CropModalContext,
    cropSelectBtn: HTMLButtonElement | null,
    cropCancelBtn: HTMLButtonElement | null,
): void {
    const { cropFileInput, cropApplyBtn, cropModal, state } = ctx;

    if (cropSelectBtn && !cropSelectBtn.hasAttribute(DATA_BOUND)) {
        cropSelectBtn.setAttribute(DATA_BOUND, "1");
        cropSelectBtn.addEventListener("click", () => {
            if (cropFileInput) {
                cropFileInput.click();
            }
        });
    }

    if (cropFileInput && !cropFileInput.hasAttribute(DATA_BOUND)) {
        cropFileInput.setAttribute(DATA_BOUND, "1");
        cropFileInput.addEventListener("change", () => {
            const file = cropFileInput.files?.[0];
            if (file) {
                loadCropFile(ctx, file);
            }
        });
    }

    if (ctx.cropZoomInput && !ctx.cropZoomInput.hasAttribute(DATA_BOUND)) {
        ctx.cropZoomInput.setAttribute(DATA_BOUND, "1");
        ctx.cropZoomInput.addEventListener("input", () => {
            const anchorX =
                state.cropViewportWidth > 0 ? state.cropViewportWidth / 2 : 0;
            const anchorY =
                state.cropViewportHeight > 0 ? state.cropViewportHeight / 2 : 0;
            setCropScaleFromZoom(
                ctx,
                ctx.cropZoomInput!.value || String(CROP_ZOOM_MIN),
                anchorX,
                anchorY,
            );
        });
    }

    if (cropApplyBtn && !cropApplyBtn.hasAttribute(DATA_BOUND)) {
        cropApplyBtn.setAttribute(DATA_BOUND, "1");
        cropApplyBtn.addEventListener("click", async () => {
            await confirmCrop(ctx);
        });
    }

    if (cropCancelBtn && !cropCancelBtn.hasAttribute(DATA_BOUND)) {
        cropCancelBtn.setAttribute(DATA_BOUND, "1");
        cropCancelBtn.addEventListener("click", () => {
            if (!state.cropUploading) {
                closeCropModal(ctx);
            }
        });
    }

    if (!cropModal.hasAttribute(DATA_BOUND)) {
        cropModal.setAttribute(DATA_BOUND, "1");
        cropModal.addEventListener("click", (event: MouseEvent) => {
            if (!state.cropUploading && event.target === cropModal) {
                closeCropModal(ctx);
            }
        });
        cropModal.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape" && !state.cropUploading) {
                closeCropModal(ctx);
            }
        });
    }
}

export function bindCropViewportEvents(ctx: CropModalContext): void {
    const { state, cropViewport } = ctx;
    if (cropViewport.hasAttribute(DATA_BOUND)) {
        return;
    }
    cropViewport.setAttribute(DATA_BOUND, "1");
    cropViewport.addEventListener("pointerdown", (event: PointerEvent) => {
        if (!state.cropLoaded) {
            return;
        }
        state.cropPointerId = event.pointerId;
        state.cropPointerX = event.clientX;
        state.cropPointerY = event.clientY;
        cropViewport.setPointerCapture(event.pointerId);
    });
    cropViewport.addEventListener("pointermove", (event: PointerEvent) => {
        if (!state.cropLoaded || state.cropPointerId !== event.pointerId) {
            return;
        }
        const deltaX = event.clientX - state.cropPointerX;
        const deltaY = event.clientY - state.cropPointerY;
        state.cropPointerX = event.clientX;
        state.cropPointerY = event.clientY;
        state.cropOffsetX += deltaX;
        state.cropOffsetY += deltaY;
        renderCropImage(ctx);
    });
    const releasePointer = (event: PointerEvent): void => {
        if (state.cropPointerId !== event.pointerId) {
            return;
        }
        if (cropViewport.hasPointerCapture(event.pointerId)) {
            cropViewport.releasePointerCapture(event.pointerId);
        }
        state.cropPointerId = null;
    };
    cropViewport.addEventListener("pointerup", releasePointer);
    cropViewport.addEventListener("pointercancel", releasePointer);
}

export function bindCropUploadButton(
    ctx: CropModalContext,
    buttonId: string,
    target: CropTarget,
): void {
    const button = document.getElementById(
        buttonId,
    ) as HTMLButtonElement | null;
    if (!button || button.hasAttribute(DATA_BOUND)) {
        return;
    }
    button.setAttribute(DATA_BOUND, "1");
    button.addEventListener("click", () => openCropModal(ctx, target));
}
