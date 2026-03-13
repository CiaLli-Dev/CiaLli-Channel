/**
 * 注册头像裁剪模块
 *
 * 包含头像裁剪弹窗的所有状态管理、渲染与事件绑定逻辑。
 */

import {
    type RegisterErrorPayload,
    resolveRegisterError,
    getCsrfToken,
    toSafeFileLabel,
} from "@/scripts/register-page-helpers";

// ── 常量 ──

const AVATAR_OUTPUT_SIZE = 512;
const AVATAR_ZOOM_MIN = 100;
const AVATAR_ZOOM_MAX = 300;
const API_UPLOAD = "/api/v1/uploads";

// ── 类型 ──

export type AvatarCropElements = {
    cropModal: HTMLElement;
    cropViewport: HTMLElement;
    cropImage: HTMLImageElement;
    cropEmpty: HTMLElement;
    cropFileInput: HTMLInputElement;
    cropSelectBtn: HTMLElement;
    cropApplyBtn: HTMLButtonElement;
    cropCancelBtn: HTMLElement;
    cropZoomInput: HTMLInputElement;
    cropMsg: HTMLElement;
};

export type AvatarCropContext = {
    avatarFileId: string;
    pendingAvatarBlob: Blob | null;
    pendingAvatarPreviewUrl: string;
    avatarUploading: boolean;
    cropObjectUrl: string;
    cropLoaded: boolean;
    cropImageWidth: number;
    cropImageHeight: number;
    cropViewportSize: number;
    cropMinScale: number;
    cropScale: number;
    cropOffsetX: number;
    cropOffsetY: number;
    cropPointerId: number | null;
    cropPointerX: number;
    cropPointerY: number;
};

export type AvatarPreviewSetter = (src: string) => void;

export type CropSetupResult = {
    openCropModal: () => void;
    uploadCroppedAvatar: (blob: Blob) => Promise<string>;
};

// ── 工具函数 ──

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

// ── 裁剪状态辅助 ──

function setCropMessage(cropMsg: HTMLElement, message: string): void {
    cropMsg.textContent = String(message || "");
}

function setCropApplyState(
    cropApplyBtn: HTMLButtonElement,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    cropApplyBtn.disabled = !ctx.cropLoaded || ctx.avatarUploading;
    cropApplyBtn.textContent = ctx.avatarUploading
        ? (i18n["cropUploading"] ?? "")
        : (i18n["cropApply"] ?? "");
}

function setCropEmptyVisible(cropEmpty: HTMLElement, visible: boolean): void {
    cropEmpty.classList.toggle("hidden", !visible);
}

function revokeCropObjectUrl(ctx: AvatarCropContext): void {
    if (!ctx.cropObjectUrl) {
        return;
    }
    URL.revokeObjectURL(ctx.cropObjectUrl);
    ctx.cropObjectUrl = "";
}

function clampCropOffset(ctx: AvatarCropContext): void {
    if (!ctx.cropLoaded || ctx.cropViewportSize <= 0) {
        return;
    }
    const scaledWidth = ctx.cropImageWidth * ctx.cropScale;
    const scaledHeight = ctx.cropImageHeight * ctx.cropScale;
    const minX = ctx.cropViewportSize - scaledWidth;
    const minY = ctx.cropViewportSize - scaledHeight;
    ctx.cropOffsetX = clamp(ctx.cropOffsetX, minX, 0);
    ctx.cropOffsetY = clamp(ctx.cropOffsetY, minY, 0);
}

// ── 渲染 ──

function renderCropImage(
    cropImage: HTMLImageElement,
    cropEmpty: HTMLElement,
    ctx: AvatarCropContext,
): void {
    if (!ctx.cropLoaded) {
        cropImage.classList.add("hidden");
        setCropEmptyVisible(cropEmpty, true);
        return;
    }
    clampCropOffset(ctx);
    cropImage.classList.remove("hidden");
    cropImage.style.width = `${ctx.cropImageWidth}px`;
    cropImage.style.height = `${ctx.cropImageHeight}px`;
    cropImage.style.transform = `translate3d(${ctx.cropOffsetX}px, ${ctx.cropOffsetY}px, 0) scale(${ctx.cropScale})`;
    cropImage.style.transformOrigin = "top left";
    setCropEmptyVisible(cropEmpty, false);
}

// ── 重置 ──

function resetCropState(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    revokeCropObjectUrl(ctx);
    ctx.cropLoaded = false;
    ctx.cropImageWidth = 0;
    ctx.cropImageHeight = 0;
    ctx.cropViewportSize = 0;
    ctx.cropMinScale = 1;
    ctx.cropScale = 1;
    ctx.cropOffsetX = 0;
    ctx.cropOffsetY = 0;
    ctx.cropPointerId = null;
    ctx.cropPointerX = 0;
    ctx.cropPointerY = 0;
    cropEls.cropImage.removeAttribute("src");
    cropEls.cropImage.classList.add("hidden");
    cropEls.cropImage.style.transform = "";
    cropEls.cropImage.style.width = "";
    cropEls.cropImage.style.height = "";
    cropEls.cropZoomInput.value = String(AVATAR_ZOOM_MIN);
    setCropMessage(cropEls.cropMsg, "");
    setCropEmptyVisible(cropEls.cropEmpty, true);
    setCropApplyState(cropEls.cropApplyBtn, ctx, i18n);
}

// ── 缩放 ──

function setCropScaleFromZoom(
    zoomValue: number | string,
    anchorX: number,
    anchorY: number,
    ctx: AvatarCropContext,
    cropEls: AvatarCropElements,
): void {
    if (!ctx.cropLoaded || ctx.cropViewportSize <= 0) {
        return;
    }
    const normalizedZoom = clamp(
        Number.isFinite(Number(zoomValue))
            ? Number(zoomValue)
            : AVATAR_ZOOM_MIN,
        AVATAR_ZOOM_MIN,
        AVATAR_ZOOM_MAX,
    );
    const nextScale = ctx.cropMinScale * (normalizedZoom / 100);
    const safeAnchorX = clamp(anchorX, 0, ctx.cropViewportSize);
    const safeAnchorY = clamp(anchorY, 0, ctx.cropViewportSize);
    const imagePointX = (safeAnchorX - ctx.cropOffsetX) / ctx.cropScale;
    const imagePointY = (safeAnchorY - ctx.cropOffsetY) / ctx.cropScale;
    ctx.cropScale = nextScale;
    ctx.cropOffsetX = safeAnchorX - imagePointX * ctx.cropScale;
    ctx.cropOffsetY = safeAnchorY - imagePointY * ctx.cropScale;
    clampCropOffset(ctx);
    renderCropImage(cropEls.cropImage, cropEls.cropEmpty, ctx);
    cropEls.cropZoomInput.value = String(Math.round(normalizedZoom));
}

// ── 打开/关闭弹窗 ──

function openCropModalFn(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    cropEls.cropModal.classList.remove("hidden");
    cropEls.cropModal.classList.add("flex");
    cropEls.cropModal.focus();
    resetCropState(cropEls, ctx, i18n);
}

function closeCropModalFn(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    cropEls.cropModal.classList.remove("flex");
    cropEls.cropModal.classList.add("hidden");
    cropEls.cropFileInput.value = "";
    resetCropState(cropEls, ctx, i18n);
}

// ── 文件加载 ──

function onCropImageLoad(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    const { cropImage, cropZoomInput } = cropEls;
    ctx.cropLoaded = true;
    ctx.cropImageWidth = Math.max(1, cropImage.naturalWidth);
    ctx.cropImageHeight = Math.max(1, cropImage.naturalHeight);
    ctx.cropViewportSize =
        Math.min(
            cropEls.cropViewport.getBoundingClientRect().width,
            cropEls.cropViewport.getBoundingClientRect().height,
        ) || 320;
    ctx.cropMinScale = Math.max(
        ctx.cropViewportSize / ctx.cropImageWidth,
        ctx.cropViewportSize / ctx.cropImageHeight,
    );
    ctx.cropScale = ctx.cropMinScale;
    ctx.cropOffsetX =
        (ctx.cropViewportSize - ctx.cropImageWidth * ctx.cropScale) / 2;
    ctx.cropOffsetY =
        (ctx.cropViewportSize - ctx.cropImageHeight * ctx.cropScale) / 2;
    cropZoomInput.value = String(AVATAR_ZOOM_MIN);
    renderCropImage(cropImage, cropEls.cropEmpty, ctx);
    setCropApplyState(cropEls.cropApplyBtn, ctx, i18n);
}

function loadCropFile(
    file: File | null | undefined,
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    i18n: Record<string, string>,
): void {
    const { cropImage, cropMsg } = cropEls;
    if (!file) {
        setCropMessage(cropMsg, i18n["selectImage"] ?? "");
        return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
        setCropMessage(cropMsg, i18n["avatarTooLarge"] ?? "");
        return;
    }
    setCropMessage(cropMsg, "");
    const nextObjectUrl = URL.createObjectURL(file);
    cropImage.onload = () => {
        onCropImageLoad(cropEls, ctx, i18n);
    };
    cropImage.onerror = () => {
        setCropMessage(cropMsg, i18n["imageReadFailed"] ?? "");
        resetCropState(cropEls, ctx, i18n);
    };
    revokeCropObjectUrl(ctx);
    ctx.cropObjectUrl = nextObjectUrl;
    cropImage.src = nextObjectUrl;
}

// ── Canvas 裁剪 ──

async function buildCropBlob(
    cropImage: HTMLImageElement,
    ctx: AvatarCropContext,
): Promise<Blob | null> {
    if (!ctx.cropLoaded || ctx.cropViewportSize <= 0) {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) {
        return null;
    }
    const ratio = AVATAR_OUTPUT_SIZE / ctx.cropViewportSize;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        cropImage,
        ctx.cropOffsetX * ratio,
        ctx.cropOffsetY * ratio,
        ctx.cropImageWidth * ctx.cropScale * ratio,
        ctx.cropImageHeight * ctx.cropScale * ratio,
    );
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
}

// ── 上传 ──

async function uploadCroppedAvatarFn(
    blob: Blob,
    emailEl: HTMLInputElement,
    i18n: Record<string, string>,
): Promise<string> {
    const avatarTitleBase = `Avatar-${toSafeFileLabel(String(emailEl.value || "").trim() || "unknown")}`;
    const formData = new FormData();
    formData.append("file", blob, `${avatarTitleBase}.jpg`);
    formData.append("title", avatarTitleBase);
    formData.append("purpose", "registration-avatar");
    const response = await fetch(API_UPLOAD, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": getCsrfToken() },
        body: formData,
    });
    const data = (await response.json().catch(() => null)) as
        | (RegisterErrorPayload & { file?: { id?: string }; ok?: boolean })
        | null;
    if (!response.ok || !data?.ok || !data?.file?.id) {
        throw new Error(
            resolveRegisterError(
                data,
                i18n as Parameters<typeof resolveRegisterError>[1],
            ),
        );
    }
    return String(data.file.id);
}

// ── 应用裁剪 ──

async function applyCrop(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    setAvatarPreviewSrc: AvatarPreviewSetter,
    i18n: Record<string, string>,
): Promise<void> {
    if (!ctx.cropLoaded || ctx.avatarUploading) {
        return;
    }
    ctx.avatarUploading = true;
    setCropApplyState(cropEls.cropApplyBtn, ctx, i18n);
    try {
        const blob = await buildCropBlob(cropEls.cropImage, ctx);
        if (!blob) {
            setCropMessage(cropEls.cropMsg, i18n["cropFailedRetry"] ?? "");
            return;
        }
        ctx.pendingAvatarBlob = blob;
        ctx.avatarFileId = "";
        if (ctx.pendingAvatarPreviewUrl) {
            URL.revokeObjectURL(ctx.pendingAvatarPreviewUrl);
            ctx.pendingAvatarPreviewUrl = "";
        }
        ctx.pendingAvatarPreviewUrl = URL.createObjectURL(blob);
        setAvatarPreviewSrc(ctx.pendingAvatarPreviewUrl);
        closeCropModalFn(cropEls, ctx, i18n);
    } catch (error) {
        setCropMessage(
            cropEls.cropMsg,
            error instanceof Error
                ? error.message
                : (i18n["avatarUploadFailed"] ?? ""),
        );
    } finally {
        ctx.avatarUploading = false;
        setCropApplyState(cropEls.cropApplyBtn, ctx, i18n);
    }
}

// ── 指针事件 ──

function bindPointerEvents(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
): void {
    const { cropViewport, cropImage, cropEmpty } = cropEls;

    cropViewport.addEventListener("pointerdown", (event: PointerEvent) => {
        if (!ctx.cropLoaded) {
            return;
        }
        ctx.cropPointerId = event.pointerId;
        ctx.cropPointerX = event.clientX;
        ctx.cropPointerY = event.clientY;
        cropViewport.setPointerCapture(event.pointerId);
    });

    cropViewport.addEventListener("pointermove", (event: PointerEvent) => {
        if (!ctx.cropLoaded || ctx.cropPointerId !== event.pointerId) {
            return;
        }
        ctx.cropOffsetX += event.clientX - ctx.cropPointerX;
        ctx.cropOffsetY += event.clientY - ctx.cropPointerY;
        ctx.cropPointerX = event.clientX;
        ctx.cropPointerY = event.clientY;
        renderCropImage(cropImage, cropEmpty, ctx);
    });

    const releasePointer = (event: PointerEvent): void => {
        if (ctx.cropPointerId !== event.pointerId) {
            return;
        }
        if (cropViewport.hasPointerCapture(event.pointerId)) {
            cropViewport.releasePointerCapture(event.pointerId);
        }
        ctx.cropPointerId = null;
    };

    cropViewport.addEventListener("pointerup", releasePointer);
    cropViewport.addEventListener("pointercancel", releasePointer);
}

// ── 公开工厂函数 ──

export function buildCropSetupResult(
    cropEls: AvatarCropElements,
    ctx: AvatarCropContext,
    emailEl: HTMLInputElement,
    setAvatarPreviewSrc: AvatarPreviewSetter,
    i18n: Record<string, string>,
): CropSetupResult {
    const openCropModal = (): void => {
        openCropModalFn(cropEls, ctx, i18n);
    };

    const uploadCroppedAvatar = (blob: Blob): Promise<string> => {
        return uploadCroppedAvatarFn(blob, emailEl, i18n);
    };

    cropEls.cropSelectBtn.addEventListener("click", () =>
        cropEls.cropFileInput.click(),
    );

    cropEls.cropFileInput.addEventListener("change", () => {
        const file = cropEls.cropFileInput.files?.[0];
        if (file) {
            loadCropFile(file, cropEls, ctx, i18n);
        }
    });

    cropEls.cropZoomInput.addEventListener("input", () => {
        const center = ctx.cropViewportSize > 0 ? ctx.cropViewportSize / 2 : 0;
        setCropScaleFromZoom(
            cropEls.cropZoomInput.value,
            center,
            center,
            ctx,
            cropEls,
        );
    });

    cropEls.cropApplyBtn.addEventListener(
        "click",
        () => void applyCrop(cropEls, ctx, setAvatarPreviewSrc, i18n),
    );

    cropEls.cropCancelBtn.addEventListener("click", () => {
        if (!ctx.avatarUploading) {
            closeCropModalFn(cropEls, ctx, i18n);
        }
    });

    cropEls.cropModal.addEventListener("click", (event) => {
        if (!ctx.avatarUploading && event.target === cropEls.cropModal) {
            closeCropModalFn(cropEls, ctx, i18n);
        }
    });

    cropEls.cropModal.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Escape" && !ctx.avatarUploading) {
            closeCropModalFn(cropEls, ctx, i18n);
        }
    });

    bindPointerEvents(cropEls, ctx);

    return { openCropModal, uploadCroppedAvatar };
}
