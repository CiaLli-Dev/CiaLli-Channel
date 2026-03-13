/**
 * site-settings-page 的裁剪工具模块。
 *
 * 包含 Crop Modal 所需的类型定义与纯计算/渲染工具函数。
 * 事件绑定与 modal 操作逻辑位于 site-settings-page-crop-actions.ts。
 */

import { JPEG_QUALITY_STEPS } from "@/constants/image";
import { UPLOAD_LIMITS } from "@/constants/upload-limits";
import type { UploadPurpose } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    CROP_ZOOM_MIN,
    CROP_OUTPUT_MAX_BYTES,
    createFaviconRow,
    createBannerImageRow,
} from "@/scripts/site-settings-page-editor";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type CropTarget = "favicon" | "banner-desktop";
export type CropTargetConfig = {
    title: string;
    help: string;
    aspectWidth: number;
    aspectHeight: number;
    outputWidth: number;
    outputHeight: number;
    outputMimeType: "image/png" | "image/jpeg";
    outputFileExt: "png" | "jpg" | "ico";
    messageTarget: string;
    titlePrefix: string;
    useSequentialName: boolean;
    useFixedName: boolean;
    maxInputBytes: number;
    purpose: UploadPurpose;
    container: HTMLElement | null;
    createRow: (value: string) => HTMLElement;
};

export type CropState = {
    activeCropTarget: CropTarget | null;
    cropUploading: boolean;
    cropObjectUrl: string;
    cropLoaded: boolean;
    cropImageWidth: number;
    cropImageHeight: number;
    cropViewportWidth: number;
    cropViewportHeight: number;
    cropMinScale: number;
    cropScale: number;
    cropOffsetX: number;
    cropOffsetY: number;
    cropPointerId: number | null;
    cropPointerX: number;
    cropPointerY: number;
    cropResizeHandlerBound: boolean;
};

export type CropModalContext = {
    state: CropState;
    cropTargets: Record<CropTarget, CropTargetConfig>;
    cropViewport: HTMLElement;
    cropImage: HTMLImageElement;
    cropModal: HTMLElement;
    cropPanel: HTMLElement | null;
    cropTitle: HTMLElement | null;
    cropHelp: HTMLElement | null;
    cropEmpty: HTMLElement | null;
    cropFileInput: HTMLInputElement | null;
    cropApplyBtn: HTMLButtonElement | null;
    cropZoomInput: HTMLInputElement | null;
    cropMsg: HTMLElement | null;
};

// ---------------------------------------------------------------------------
// 内部辅助（供 crop-actions 文件使用）
// ---------------------------------------------------------------------------

export function setCropMessage(ctx: CropModalContext, message: string): void {
    if (ctx.cropMsg) {
        ctx.cropMsg.textContent = message;
    }
}

export function setCropEmptyVisible(
    ctx: CropModalContext,
    visible: boolean,
): void {
    if (ctx.cropEmpty) {
        ctx.cropEmpty.classList.toggle("hidden", !visible);
    }
}

export function updateCropApplyState(ctx: CropModalContext): void {
    if (ctx.cropApplyBtn) {
        ctx.cropApplyBtn.disabled = !(
            ctx.state.cropLoaded && !ctx.state.cropUploading
        );
        ctx.cropApplyBtn.textContent = ctx.state.cropUploading
            ? t(I18nKey.interactionCommonProcessing)
            : t(I18nKey.interactionCommonApplyCrop);
    }
}

export function revokeCropObjectUrl(ctx: CropModalContext): void {
    if (ctx.state.cropObjectUrl) {
        URL.revokeObjectURL(ctx.state.cropObjectUrl);
        ctx.state.cropObjectUrl = "";
    }
}

// ---------------------------------------------------------------------------
// buildCropTargets
// ---------------------------------------------------------------------------

export function buildCropTargets(
    faviconCtr: HTMLElement | null,
    bannerCtr: HTMLElement | null,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
): Record<CropTarget, CropTargetConfig> {
    return {
        favicon: {
            title: t(I18nKey.adminSiteSettingsCropFaviconTitle),
            help: t(I18nKey.adminSiteSettingsCropFaviconHelp),
            aspectWidth: 1,
            aspectHeight: 1,
            outputWidth: 256,
            outputHeight: 256,
            outputMimeType: "image/png",
            outputFileExt: "ico",
            messageTarget: "ss-site-msg",
            titlePrefix: "Favicon",
            useSequentialName: false,
            useFixedName: true,
            maxInputBytes: UPLOAD_LIMITS.favicon,
            purpose: "favicon",
            container: faviconCtr,
            createRow: (value: string) => createFaviconRow({ src: value }),
        },
        "banner-desktop": {
            title: t(I18nKey.adminSiteSettingsCropBannerTitle),
            help: t(I18nKey.adminSiteSettingsCropBannerHelp),
            aspectWidth: 16,
            aspectHeight: 9,
            outputWidth: 1600,
            outputHeight: 900,
            outputMimeType: "image/jpeg",
            outputFileExt: "jpg",
            messageTarget: "ss-home-msg",
            titlePrefix: "Banner Desktop",
            useSequentialName: true,
            useFixedName: false,
            maxInputBytes: UPLOAD_LIMITS.banner,
            purpose: "banner",
            container: bannerCtr,
            createRow: (value: string) =>
                createBannerImageRow(
                    value,
                    bannerCtr as HTMLElement,
                    getDragSource,
                    setDragSource,
                ),
        },
    };
}

// ---------------------------------------------------------------------------
// Crop 视口工具
// ---------------------------------------------------------------------------

export function applyCropViewportBounds(
    cropViewport: HTMLElement,
    config: CropTargetConfig,
): void {
    const viewportMarginX = 48;
    const reservedVerticalSpace = 330;
    const maxHeight = Math.max(
        220,
        Math.min(700, window.innerHeight - reservedVerticalSpace),
    );
    const widthByHeight =
        maxHeight * (config.aspectWidth / config.aspectHeight);
    let maxWidth = Math.max(
        180,
        Math.min(640, window.innerWidth - viewportMarginX, widthByHeight),
    );
    let boundedMaxHeight = maxHeight;
    if (config.aspectWidth === 1 && config.aspectHeight === 1) {
        const avatarLikeSide = Math.max(
            220,
            Math.min(
                360,
                window.innerWidth - viewportMarginX,
                window.innerHeight - reservedVerticalSpace,
            ),
        );
        maxWidth = avatarLikeSide;
        boundedMaxHeight = avatarLikeSide;
    }
    cropViewport.style.maxWidth = `${Math.floor(maxWidth)}px`;
    cropViewport.style.maxHeight = `${Math.floor(boundedMaxHeight)}px`;
}

// ---------------------------------------------------------------------------
// Crop 图像渲染
// ---------------------------------------------------------------------------

export function clampCropOffset(state: CropState): void {
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return;
    }
    const scaledWidth = state.cropImageWidth * state.cropScale;
    const scaledHeight = state.cropImageHeight * state.cropScale;
    const minX = state.cropViewportWidth - scaledWidth;
    const minY = state.cropViewportHeight - scaledHeight;
    state.cropOffsetX = Math.max(minX, Math.min(0, state.cropOffsetX));
    state.cropOffsetY = Math.max(minY, Math.min(0, state.cropOffsetY));
}

export function renderCropImage(ctx: CropModalContext): void {
    const { state, cropImage } = ctx;
    if (!state.cropLoaded) {
        cropImage.classList.add("hidden");
        setCropEmptyVisible(ctx, true);
        return;
    }
    clampCropOffset(state);
    cropImage.classList.remove("hidden");
    cropImage.style.width = `${state.cropImageWidth}px`;
    cropImage.style.height = `${state.cropImageHeight}px`;
    cropImage.style.transformOrigin = "top left";
    cropImage.style.transform = `translate3d(${state.cropOffsetX}px, ${state.cropOffsetY}px, 0) scale(${state.cropScale})`;
    setCropEmptyVisible(ctx, false);
}

// ---------------------------------------------------------------------------
// Crop blob 生成
// ---------------------------------------------------------------------------

export async function buildCropBlob(
    state: CropState,
    cropImage: HTMLImageElement,
    outputWidth: number,
    outputHeight: number,
    mimeType: "image/png" | "image/jpeg",
    quality?: number,
): Promise<Blob | null> {
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }
    const ratioX = outputWidth / state.cropViewportWidth;
    const ratioY = outputHeight / state.cropViewportHeight;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        cropImage,
        state.cropOffsetX * ratioX,
        state.cropOffsetY * ratioY,
        state.cropImageWidth * state.cropScale * ratioX,
        state.cropImageHeight * state.cropScale * ratioY,
    );
    return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });
}

export async function buildCropBlobWithLimit(
    state: CropState,
    cropImage: HTMLImageElement,
    outputWidth: number,
    outputHeight: number,
    mimeType: "image/png" | "image/jpeg",
): Promise<Blob | null> {
    if (mimeType === "image/png") {
        const blob = await buildCropBlob(
            state,
            cropImage,
            outputWidth,
            outputHeight,
            mimeType,
        );
        return blob && blob.size <= CROP_OUTPUT_MAX_BYTES ? blob : null;
    }
    const qualities = JPEG_QUALITY_STEPS;
    for (const quality of qualities) {
        const blob = await buildCropBlob(
            state,
            cropImage,
            outputWidth,
            outputHeight,
            mimeType,
            quality,
        );
        if (blob && blob.size <= CROP_OUTPUT_MAX_BYTES) {
            return blob;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// resetCropState
// ---------------------------------------------------------------------------

export function resetCropState(ctx: CropModalContext): void {
    revokeCropObjectUrl(ctx);
    const { state, cropImage, cropZoomInput } = ctx;
    state.cropLoaded = false;
    state.cropImageWidth = 0;
    state.cropImageHeight = 0;
    state.cropViewportWidth = 0;
    state.cropViewportHeight = 0;
    state.cropMinScale = 1;
    state.cropScale = 1;
    state.cropOffsetX = 0;
    state.cropOffsetY = 0;
    state.cropPointerId = null;
    state.cropPointerX = 0;
    state.cropPointerY = 0;
    cropImage.removeAttribute("src");
    cropImage.classList.add("hidden");
    cropImage.style.transform = "";
    cropImage.style.width = "";
    cropImage.style.height = "";
    cropImage.style.transformOrigin = "top left";
    if (cropZoomInput) {
        cropZoomInput.value = String(CROP_ZOOM_MIN);
    }
    setCropEmptyVisible(ctx, true);
    updateCropApplyState(ctx);
}
