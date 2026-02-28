/**
 * /me/homepage 编辑页面逻辑 — 头图上传 + 模块排序
 */

import I18nKey from "@/i18n/i18nKey";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { t, tFmt } from "@/scripts/i18n-runtime";
import {
    finishTask,
    runWithTask,
    startTask,
    updateTask,
    type ProgressTaskHandle,
} from "@/scripts/progress-overlay-manager";
import { getCsrfToken } from "@/utils/csrf";
import {
    clamp,
    buildAssetUrl,
    buildLoginRedirectHref,
    extractFileId,
} from "@/scripts/dom-helpers";

// ---------------------------------------------------------------------------
// 共享工具
// ---------------------------------------------------------------------------

const normalizeApiUrl = (input: string): string => {
    const [pathname, search = ""] = String(input || "").split("?");
    const normalizedPath = pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname;
    return search ? `${normalizedPath}?${search}` : normalizedPath;
};

interface ApiResult {
    response: Response;
    data: Record<string, unknown> | null;
}

const api = async (url: string, init: RequestInit = {}): Promise<ApiResult> => {
    const isFormData =
        typeof FormData !== "undefined" &&
        Boolean(init.body) &&
        init.body instanceof FormData;
    const response = await fetch(normalizeApiUrl(url), {
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": getCsrfToken(),
            ...(init.body && !isFormData
                ? { "Content-Type": "application/json" }
                : {}),
            ...((init.headers as Record<string, string>) || {}),
        },
        ...init,
    });
    const data: Record<string, unknown> | null = await response
        .json()
        .catch(() => null);
    return { response, data };
};

const getErrorMessage = (
    data: Record<string, unknown> | null,
    fallback: string,
): string => {
    const error = data?.error as Record<string, unknown> | undefined;
    return (error?.message as string | undefined) || fallback;
};

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const AUTH_ME_RETRY_DELAY_MS = 220;
const HEADER_CROP_OUTPUT_WIDTH = 1200;
const HEADER_CROP_OUTPUT_HEIGHT = 400;
const CROP_ZOOM_MIN = 100;
const CROP_ZOOM_MAX = 300;
const DATA_BOUND = "data-homepage-bound";
const BANGUMI_ID_PATTERN = /^[0-9]+$/;

const toSafeFileLabel = (value: string): string =>
    String(value || "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ");

const DEFAULT_SECTION_ORDER = ["articles", "diaries", "bangumi", "albums"];

const SECTION_LABELS: Record<string, { icon: string; name: string }> = {
    articles: { icon: "📝", name: t(I18nKey.meHomepageSectionArticles) },
    diaries: { icon: "📔", name: t(I18nKey.meHomepageSectionDiaries) },
    bangumi: { icon: "🎬", name: t(I18nKey.meHomepageSectionBangumi) },
    albums: { icon: "📷", name: t(I18nKey.meHomepageSectionAlbums) },
};

// ---------------------------------------------------------------------------
// initMeHomepagePage
// ---------------------------------------------------------------------------

export function initMeHomepagePage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/me/homepage") {
        return;
    }

    // ---- DOM 引用 ----
    const editorSections = document.getElementById("homepage-editor-sections");
    const headerPreviewArea = document.getElementById(
        "homepage-header-preview-area",
    );
    const headerPreview = document.getElementById(
        "homepage-header-preview",
    ) as HTMLImageElement | null;
    const headerEmpty = document.getElementById("homepage-header-empty");
    const headerChangeBtn = document.getElementById(
        "homepage-header-change-btn",
    );
    const headerRemoveBtn = document.getElementById(
        "homepage-header-remove-btn",
    );
    const headerSaveBtn = document.getElementById("homepage-header-save-btn");
    const headerMsg = document.getElementById("homepage-header-msg");

    const sectionOrderList = document.getElementById(
        "homepage-section-order-list",
    );
    const sectionResetBtn = document.getElementById(
        "homepage-section-reset-btn",
    );
    const sectionSaveBtn = document.getElementById("homepage-section-save-btn");
    const sectionMsg = document.getElementById("homepage-section-msg");
    const bangumiForm = document.getElementById(
        "homepage-bangumi-form",
    ) as HTMLFormElement | null;
    const bangumiShowInput = document.getElementById(
        "homepage-bangumi-show",
    ) as HTMLInputElement | null;
    const bangumiPrivateInput = document.getElementById(
        "homepage-bangumi-private",
    ) as HTMLInputElement | null;
    const bangumiUsernameInput = document.getElementById(
        "homepage-bangumi-username",
    ) as HTMLInputElement | null;
    const bangumiTokenInput = document.getElementById(
        "homepage-bangumi-token",
    ) as HTMLInputElement | null;
    const bangumiTokenState = document.getElementById(
        "homepage-bangumi-token-state",
    );
    const bangumiClearTokenBtn = document.getElementById(
        "homepage-bangumi-clear-token-btn",
    ) as HTMLButtonElement | null;
    const bangumiMsg = document.getElementById("homepage-bangumi-msg");

    // 裁剪弹窗
    const cropModal = document.getElementById("homepage-header-crop-modal");
    const cropViewport = document.getElementById(
        "homepage-header-crop-viewport",
    );
    const cropImage = document.getElementById(
        "homepage-header-crop-image",
    ) as HTMLImageElement | null;
    const cropEmpty = document.getElementById("homepage-header-crop-empty");
    const cropFileInput = document.getElementById(
        "homepage-header-crop-file",
    ) as HTMLInputElement | null;
    const cropSelectBtn = document.getElementById(
        "homepage-header-crop-select-btn",
    );
    const cropApplyBtn = document.getElementById(
        "homepage-header-crop-apply-btn",
    ) as HTMLButtonElement | null;
    const cropCancelBtn = document.getElementById(
        "homepage-header-crop-cancel-btn",
    );
    const cropZoomInput = document.getElementById(
        "homepage-header-crop-zoom",
    ) as HTMLInputElement | null;
    const cropMsg = document.getElementById("homepage-header-crop-msg");

    if (!editorSections) {
        return;
    }

    // ---- 可变状态 ----
    let currentHeaderFileId = "";
    let currentLoginEmail = "";
    let pendingHeaderUpload: { blob: Blob; previewUrl: string } | null = null;
    let headerRemoved = false;
    let bangumiTokenSet = false;
    let bangumiTokenClearRequested = false;

    // 裁剪状态
    let cropObjectUrl = "";
    let cropLoaded = false;
    let cropImageWidth = 0;
    let cropImageHeight = 0;
    let cropViewportWidth = 0;
    let cropViewportHeight = 0;
    let cropMinScale = 1;
    let cropScale = 1;
    let cropOffsetX = 0;
    let cropOffsetY = 0;
    let cropPointerId: number | null = null;
    let cropPointerX = 0;
    let cropPointerY = 0;
    let cropUploading = false;
    let headerSaveTaskHandle: ProgressTaskHandle | null = null;

    // 模块排序拖拽状态
    let sectionDragSource: HTMLElement | null = null;

    // ---- 辅助函数 ----

    const setHeaderMsg = (msg: string): void => {
        if (headerMsg) {
            headerMsg.textContent = msg;
        }
    };

    const setSectionMsg = (msg: string): void => {
        if (sectionMsg) {
            sectionMsg.textContent = msg;
        }
    };

    const setCropMsg = (msg: string): void => {
        if (cropMsg) {
            cropMsg.textContent = msg;
        }
    };

    const setBangumiMsg = (msg: string): void => {
        if (bangumiMsg) {
            bangumiMsg.textContent = msg;
        }
    };

    const refreshBangumiTokenState = (): void => {
        if (!bangumiTokenState) {
            return;
        }
        const editingToken = String(bangumiTokenInput?.value || "").trim();
        if (bangumiTokenClearRequested) {
            bangumiTokenState.textContent = t(
                I18nKey.meHomepageBangumiTokenWillClear,
            );
            return;
        }
        if (editingToken) {
            bangumiTokenState.textContent = t(
                I18nKey.meHomepageBangumiTokenWillUpdate,
            );
            return;
        }
        bangumiTokenState.textContent = bangumiTokenSet
            ? t(I18nKey.meHomepageBangumiTokenSet)
            : t(I18nKey.meHomepageBangumiTokenNotSet);
    };

    const clearPendingHeaderUpload = (revokePreview = true): void => {
        if (!pendingHeaderUpload) {
            return;
        }
        if (revokePreview) {
            URL.revokeObjectURL(pendingHeaderUpload.previewUrl);
        }
        pendingHeaderUpload = null;
    };

    const updateHeaderPreview = (): void => {
        if (!headerPreview || !headerEmpty) {
            return;
        }
        const src =
            pendingHeaderUpload?.previewUrl ||
            (currentHeaderFileId ? buildAssetUrl(currentHeaderFileId) : "");
        if (src && !headerRemoved) {
            headerPreview.src = src;
            headerPreview.classList.remove("hidden");
            headerEmpty.classList.add("hidden");
        } else {
            headerPreview.removeAttribute("src");
            headerPreview.classList.add("hidden");
            headerEmpty.classList.remove("hidden");
        }
    };

    // ---- 裁剪弹窗 ----

    const revokeCropObjectUrl = (): void => {
        if (cropObjectUrl) {
            URL.revokeObjectURL(cropObjectUrl);
            cropObjectUrl = "";
        }
    };

    const measureCropViewportSize = (): { width: number; height: number } => {
        if (!cropViewport) {
            return { width: 0, height: 0 };
        }
        const rect = cropViewport.getBoundingClientRect();
        return {
            width: Math.max(0, Math.floor(rect.width)),
            height: Math.max(0, Math.floor(rect.height)),
        };
    };

    const clampCropOffset = (): void => {
        if (!cropLoaded || cropViewportWidth <= 0 || cropViewportHeight <= 0) {
            return;
        }
        const scaledWidth = cropImageWidth * cropScale;
        const scaledHeight = cropImageHeight * cropScale;
        const minX = cropViewportWidth - scaledWidth;
        const minY = cropViewportHeight - scaledHeight;
        cropOffsetX = clamp(cropOffsetX, minX, 0);
        cropOffsetY = clamp(cropOffsetY, minY, 0);
    };

    const renderCropImage = (): void => {
        if (!cropImage) {
            return;
        }
        if (!cropLoaded) {
            cropImage.classList.add("hidden");
            if (cropEmpty) {
                cropEmpty.classList.remove("hidden");
            }
            return;
        }
        clampCropOffset();
        cropImage.classList.remove("hidden");
        cropImage.style.width = `${cropImageWidth}px`;
        cropImage.style.height = `${cropImageHeight}px`;
        cropImage.style.transformOrigin = "top left";
        cropImage.style.transform = `translate3d(${cropOffsetX}px, ${cropOffsetY}px, 0) scale(${cropScale})`;
        if (cropEmpty) {
            cropEmpty.classList.add("hidden");
        }
    };

    const updateCropApplyState = (): void => {
        if (cropApplyBtn) {
            cropApplyBtn.disabled = !cropLoaded || cropUploading;
            cropApplyBtn.textContent = cropUploading
                ? t(I18nKey.commonProcessing)
                : t(I18nKey.commonApplyCrop);
        }
    };

    const resetCropState = (): void => {
        revokeCropObjectUrl();
        cropLoaded = false;
        cropImageWidth = 0;
        cropImageHeight = 0;
        cropViewportWidth = 0;
        cropViewportHeight = 0;
        cropMinScale = 1;
        cropScale = 1;
        cropOffsetX = 0;
        cropOffsetY = 0;
        cropPointerId = null;
        cropPointerX = 0;
        cropPointerY = 0;
        if (cropImage) {
            cropImage.removeAttribute("src");
            cropImage.classList.add("hidden");
            cropImage.style.transform = "";
            cropImage.style.width = "";
            cropImage.style.height = "";
            cropImage.style.transformOrigin = "top left";
        }
        if (cropZoomInput) {
            cropZoomInput.value = String(CROP_ZOOM_MIN);
        }
        if (cropEmpty) {
            cropEmpty.classList.remove("hidden");
        }
        updateCropApplyState();
    };

    const openCropModal = (): void => {
        if (!cropModal) {
            setHeaderMsg(t(I18nKey.meHomepageCropInitFailed));
            return;
        }
        cropModal.classList.remove("hidden");
        cropModal.classList.add("flex");
        document.body.classList.add("overflow-hidden");
        cropModal.focus();
    };

    const closeCropModal = (): void => {
        if (!cropModal) {
            return;
        }
        cropModal.classList.remove("flex");
        cropModal.classList.add("hidden");
        document.body.classList.remove("overflow-hidden");
        if (cropFileInput) {
            cropFileInput.value = "";
        }
        resetCropState();
        cropUploading = false;
        updateCropApplyState();
        setCropMsg("");
    };

    const setCropScaleFromZoom = (
        zoomPercent: number,
        anchorX: number,
        anchorY: number,
    ): void => {
        if (!cropLoaded || cropViewportWidth <= 0 || cropViewportHeight <= 0) {
            return;
        }
        const normalizedZoom = clamp(
            Number.isFinite(zoomPercent) ? zoomPercent : CROP_ZOOM_MIN,
            CROP_ZOOM_MIN,
            CROP_ZOOM_MAX,
        );
        const nextScale = cropMinScale * (normalizedZoom / 100);
        const safeAnchorX = clamp(anchorX, 0, cropViewportWidth);
        const safeAnchorY = clamp(anchorY, 0, cropViewportHeight);
        const imagePointX = (safeAnchorX - cropOffsetX) / cropScale;
        const imagePointY = (safeAnchorY - cropOffsetY) / cropScale;
        cropScale = nextScale;
        cropOffsetX = safeAnchorX - imagePointX * cropScale;
        cropOffsetY = safeAnchorY - imagePointY * cropScale;
        clampCropOffset();
        renderCropImage();
        if (cropZoomInput) {
            cropZoomInput.value = String(Math.round(normalizedZoom));
        }
    };

    const loadCropFile = (file: File): void => {
        if (!cropImage) {
            setCropMsg(t(I18nKey.meHomepageCropInitFailed));
            return;
        }
        if (!file.type.startsWith("image/")) {
            setCropMsg(t(I18nKey.commonSelectImage));
            return;
        }
        if (file.size > UPLOAD_LIMITS.banner) {
            setCropMsg(
                tFmt(I18nKey.commonImageTooLarge, {
                    size: UPLOAD_LIMIT_LABELS.banner,
                }),
            );
            return;
        }
        setCropMsg("");
        const nextObjectUrl = URL.createObjectURL(file);
        const img = cropImage;
        img.onload = () => {
            cropLoaded = true;
            cropImageWidth = Math.max(1, img.naturalWidth);
            cropImageHeight = Math.max(1, img.naturalHeight);
            const size = measureCropViewportSize();
            cropViewportWidth = size.width || 600;
            cropViewportHeight = size.height || 200;
            // 确保图片完全覆盖视口
            cropMinScale = Math.max(
                cropViewportWidth / cropImageWidth,
                cropViewportHeight / cropImageHeight,
            );
            cropScale = cropMinScale;
            cropOffsetX = (cropViewportWidth - cropImageWidth * cropScale) / 2;
            cropOffsetY =
                (cropViewportHeight - cropImageHeight * cropScale) / 2;
            if (cropZoomInput) {
                cropZoomInput.value = String(CROP_ZOOM_MIN);
            }
            renderCropImage();
            updateCropApplyState();
        };
        img.onerror = () => {
            setCropMsg(t(I18nKey.commonImageReadFailed));
            resetCropState();
        };
        revokeCropObjectUrl();
        cropObjectUrl = nextObjectUrl;
        img.src = nextObjectUrl;
    };

    const buildCropBlob = async (): Promise<Blob | null> => {
        if (!cropLoaded || !cropImage) {
            return null;
        }
        if (cropViewportWidth <= 0 || cropViewportHeight <= 0) {
            return null;
        }
        const canvas = document.createElement("canvas");
        canvas.width = HEADER_CROP_OUTPUT_WIDTH;
        canvas.height = HEADER_CROP_OUTPUT_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return null;
        }
        const ratioX = HEADER_CROP_OUTPUT_WIDTH / cropViewportWidth;
        const ratioY = HEADER_CROP_OUTPUT_HEIGHT / cropViewportHeight;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
            cropImage,
            cropOffsetX * ratioX,
            cropOffsetY * ratioY,
            cropImageWidth * cropScale * ratioX,
            cropImageHeight * cropScale * ratioY,
        );
        return await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
        });
    };

    const applyHeaderFromCrop = async (): Promise<void> => {
        if (!cropLoaded) {
            setCropMsg(t(I18nKey.meHomepageHeaderSelectFirst));
            return;
        }
        cropUploading = true;
        updateCropApplyState();
        try {
            const croppedBlob = await buildCropBlob();
            if (!croppedBlob) {
                setCropMsg(t(I18nKey.meHomepageHeaderCropFailed));
                return;
            }
            clearPendingHeaderUpload(true);
            pendingHeaderUpload = {
                blob: croppedBlob,
                previewUrl: URL.createObjectURL(croppedBlob),
            };
            headerRemoved = false;
            currentHeaderFileId = "";
            updateHeaderPreview();
            closeCropModal();
            setHeaderMsg(t(I18nKey.meHomepageHeaderUpdatedPendingSave));
        } finally {
            cropUploading = false;
            updateCropApplyState();
        }
    };

    // ---- 模块排序 ----

    const createSectionRow = (key: string): HTMLElement => {
        const info = SECTION_LABELS[key] || { icon: "📋", name: key };
        const row = document.createElement("div");
        row.className =
            "flex items-center gap-3 px-4 py-3 rounded-lg border border-(--line-divider) bg-black/3 dark:bg-white/3 cursor-grab active:cursor-grabbing select-none";
        row.dataset.sectionKey = key;
        row.draggable = true;

        const handle = document.createElement("span");
        handle.className =
            "text-30 hover:text-60 transition-colors text-lg leading-none";
        handle.textContent = "≡";

        const icon = document.createElement("span");
        icon.className = "text-lg";
        icon.textContent = info.icon;

        const name = document.createElement("span");
        name.className = "text-sm font-medium text-75";
        name.textContent = info.name;

        row.appendChild(handle);
        row.appendChild(icon);
        row.appendChild(name);

        // 拖拽事件
        row.addEventListener("dragstart", (e) => {
            row.classList.add("opacity-40");
            e.dataTransfer?.setData("text/plain", "");
            sectionDragSource = row;
        });
        row.addEventListener("dragend", () => {
            row.classList.remove("opacity-40");
            sectionDragSource = null;
            sectionOrderList
                ?.querySelectorAll(":scope > div")
                .forEach((el) => ((el as HTMLElement).style.borderTop = ""));
        });
        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            if (sectionDragSource && sectionDragSource !== row) {
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
                !sectionDragSource ||
                sectionDragSource === row ||
                !sectionOrderList
            ) {
                return;
            }
            const rows = [...sectionOrderList.children];
            const fromIdx = rows.indexOf(sectionDragSource);
            const toIdx = rows.indexOf(row);
            if (fromIdx < toIdx) {
                row.after(sectionDragSource);
            } else {
                row.before(sectionDragSource);
            }
        });

        return row;
    };

    const fillSectionOrder = (order: string[] | null): void => {
        if (!sectionOrderList) {
            return;
        }
        sectionOrderList.innerHTML = "";
        const sections = order ?? DEFAULT_SECTION_ORDER;
        for (const key of sections) {
            if (SECTION_LABELS[key]) {
                sectionOrderList.appendChild(createSectionRow(key));
            }
        }
        // 补全缺失的 section
        for (const key of DEFAULT_SECTION_ORDER) {
            if (
                !sections.includes(key) &&
                !sectionOrderList.querySelector(`[data-section-key="${key}"]`)
            ) {
                sectionOrderList.appendChild(createSectionRow(key));
            }
        }
    };

    const collectSectionOrder = (): string[] => {
        if (!sectionOrderList) {
            return DEFAULT_SECTION_ORDER;
        }
        const order: string[] = [];
        const rows = sectionOrderList.querySelectorAll("[data-section-key]");
        for (const row of rows) {
            const key = (row as HTMLElement).dataset.sectionKey;
            if (key) {
                order.push(key);
            }
        }
        return order;
    };

    const fillBangumiConfig = (
        profile: Record<string, unknown> | undefined,
    ): void => {
        if (bangumiShowInput) {
            bangumiShowInput.checked = Boolean(
                profile?.show_bangumi_on_profile ?? true,
            );
        }
        if (bangumiPrivateInput) {
            bangumiPrivateInput.checked = Boolean(
                profile?.bangumi_include_private ?? false,
            );
        }
        if (bangumiUsernameInput) {
            bangumiUsernameInput.value = String(
                profile?.bangumi_username || "",
            ).trim();
        }
        if (bangumiTokenInput) {
            bangumiTokenInput.value = "";
        }
        bangumiTokenSet = Boolean(profile?.bangumi_access_token_set);
        bangumiTokenClearRequested = false;
        refreshBangumiTokenState();
    };

    const buildBangumiPatchPayload = (): Record<string, unknown> => {
        const payload: Record<string, unknown> = {
            show_bangumi_on_profile: bangumiShowInput?.checked ?? true,
            bangumi_username:
                String(bangumiUsernameInput?.value || "").trim() || null,
            bangumi_include_private: bangumiPrivateInput?.checked ?? false,
        };

        if (bangumiTokenClearRequested) {
            payload.bangumi_access_token = null;
            return payload;
        }

        const token = String(bangumiTokenInput?.value || "").trim();
        if (token) {
            payload.bangumi_access_token = token;
        }
        return payload;
    };

    // ---- 认证与数据加载 ----

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

    // ---- 事件绑定 ----

    // 头图预览区域点击
    if (headerPreviewArea && !headerPreviewArea.hasAttribute(DATA_BOUND)) {
        headerPreviewArea.setAttribute(DATA_BOUND, "");
        headerPreviewArea.addEventListener("click", () => {
            openCropModal();
            setHeaderMsg("");
        });
    }

    // 更换头图
    if (headerChangeBtn && !headerChangeBtn.hasAttribute(DATA_BOUND)) {
        headerChangeBtn.setAttribute(DATA_BOUND, "");
        headerChangeBtn.addEventListener("click", () => {
            openCropModal();
            setHeaderMsg("");
        });
    }

    // 移除头图
    if (headerRemoveBtn && !headerRemoveBtn.hasAttribute(DATA_BOUND)) {
        headerRemoveBtn.setAttribute(DATA_BOUND, "");
        headerRemoveBtn.addEventListener("click", () => {
            clearPendingHeaderUpload(true);
            currentHeaderFileId = "";
            headerRemoved = true;
            updateHeaderPreview();
            setHeaderMsg(t(I18nKey.meHomepageHeaderRemovedPendingSave));
        });
    }

    // 保存头图
    if (headerSaveBtn && !headerSaveBtn.hasAttribute(DATA_BOUND)) {
        headerSaveBtn.setAttribute(DATA_BOUND, "");
        headerSaveBtn.addEventListener("click", async () => {
            setHeaderMsg(t(I18nKey.commonSaving));
            if (headerSaveTaskHandle !== null) {
                finishTask(headerSaveTaskHandle);
            }
            headerSaveTaskHandle = startTask({
                title: t(I18nKey.meHomepageHeaderSavingTitle),
                mode: "indeterminate",
                text: t(I18nKey.meHomepageHeaderSavingText),
            });
            try {
                let fileId: string | null = currentHeaderFileId || null;

                if (pendingHeaderUpload) {
                    updateTask(headerSaveTaskHandle, {
                        text: t(I18nKey.meHomepageHeaderUploadingText),
                    });
                    // 上传头图
                    const formData = new FormData();
                    const headerTitleBase = `Header-${toSafeFileLabel(currentLoginEmail || "unknown")}`;
                    formData.append(
                        "file",
                        pendingHeaderUpload.blob,
                        `${headerTitleBase}.jpg`,
                    );
                    formData.append("title", headerTitleBase);
                    formData.append("purpose", "banner");
                    const uploadResult = await api("/api/v1/uploads", {
                        method: "POST",
                        body: formData,
                    });
                    if (
                        !uploadResult.response.ok ||
                        !uploadResult.data?.ok ||
                        !(
                            uploadResult.data?.file as
                                | Record<string, unknown>
                                | undefined
                        )?.id
                    ) {
                        setHeaderMsg(
                            getErrorMessage(
                                uploadResult.data,
                                t(I18nKey.meHomepageHeaderUploadFailed),
                            ),
                        );
                        return;
                    }
                    fileId = String(
                        (uploadResult.data.file as Record<string, unknown>).id,
                    );
                    clearPendingHeaderUpload(true);
                    currentHeaderFileId = fileId;
                } else if (headerRemoved) {
                    fileId = null;
                } else {
                    setHeaderMsg(t(I18nKey.commonNoChangesToSave));
                    return;
                }

                updateTask(headerSaveTaskHandle, {
                    text: t(I18nKey.meHomepageConfigSavingText),
                });
                const { response, data } = await api("/api/v1/me/profile", {
                    method: "PATCH",
                    body: JSON.stringify({ header_file: fileId }),
                });
                if (!response.ok || !data?.ok) {
                    setHeaderMsg(
                        getErrorMessage(data, t(I18nKey.commonSaveFailed)),
                    );
                    return;
                }
                headerRemoved = false;
                if (fileId) {
                    currentHeaderFileId = fileId;
                } else {
                    currentHeaderFileId = "";
                }
                updateHeaderPreview();
                setHeaderMsg(t(I18nKey.commonSaved));
                updateTask(headerSaveTaskHandle, {
                    text: t(I18nKey.commonSaveCompleted),
                });
            } catch {
                setHeaderMsg(t(I18nKey.commonSaveFailedRetry));
            } finally {
                if (headerSaveTaskHandle !== null) {
                    finishTask(headerSaveTaskHandle);
                    headerSaveTaskHandle = null;
                }
            }
        });
    }

    // 裁剪弹窗事件
    if (cropSelectBtn && !cropSelectBtn.hasAttribute(DATA_BOUND)) {
        cropSelectBtn.setAttribute(DATA_BOUND, "");
        cropSelectBtn.addEventListener("click", () => {
            if (cropFileInput) {
                cropFileInput.click();
            }
        });
    }

    if (cropFileInput && !cropFileInput.hasAttribute(DATA_BOUND)) {
        cropFileInput.setAttribute(DATA_BOUND, "");
        cropFileInput.addEventListener("change", () => {
            const file = cropFileInput.files?.[0];
            if (file) {
                loadCropFile(file);
            }
        });
    }

    if (cropZoomInput && !cropZoomInput.hasAttribute(DATA_BOUND)) {
        cropZoomInput.setAttribute(DATA_BOUND, "");
        cropZoomInput.addEventListener("input", () => {
            const zoom = Number.parseFloat(
                cropZoomInput.value || String(CROP_ZOOM_MIN),
            );
            const anchorX = cropViewportWidth > 0 ? cropViewportWidth / 2 : 0;
            const anchorY = cropViewportHeight > 0 ? cropViewportHeight / 2 : 0;
            setCropScaleFromZoom(zoom, anchorX, anchorY);
        });
    }

    if (cropApplyBtn && !cropApplyBtn.hasAttribute(DATA_BOUND)) {
        cropApplyBtn.setAttribute(DATA_BOUND, "");
        cropApplyBtn.addEventListener("click", async () => {
            await applyHeaderFromCrop();
        });
    }

    if (cropCancelBtn && !cropCancelBtn.hasAttribute(DATA_BOUND)) {
        cropCancelBtn.setAttribute(DATA_BOUND, "");
        cropCancelBtn.addEventListener("click", () => {
            if (!cropUploading) {
                closeCropModal();
            }
        });
    }

    if (cropModal && !cropModal.hasAttribute(DATA_BOUND)) {
        cropModal.setAttribute(DATA_BOUND, "");
        cropModal.addEventListener("click", (event: MouseEvent) => {
            if (!cropUploading && event.target === cropModal) {
                closeCropModal();
            }
        });
        cropModal.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape" && !cropUploading) {
                closeCropModal();
            }
        });
    }

    if (cropViewport && !cropViewport.hasAttribute(DATA_BOUND)) {
        cropViewport.setAttribute(DATA_BOUND, "");
        cropViewport.addEventListener("pointerdown", (event: PointerEvent) => {
            if (!cropLoaded || !cropViewport) {
                return;
            }
            cropPointerId = event.pointerId;
            cropPointerX = event.clientX;
            cropPointerY = event.clientY;
            cropViewport.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        cropViewport.addEventListener("pointermove", (event: PointerEvent) => {
            if (!cropLoaded || cropPointerId !== event.pointerId) {
                return;
            }
            const deltaX = event.clientX - cropPointerX;
            const deltaY = event.clientY - cropPointerY;
            cropPointerX = event.clientX;
            cropPointerY = event.clientY;
            cropOffsetX += deltaX;
            cropOffsetY += deltaY;
            renderCropImage();
            event.preventDefault();
        });
        const releasePointer = (event: PointerEvent): void => {
            if (cropPointerId !== event.pointerId || !cropViewport) {
                return;
            }
            if (cropViewport.hasPointerCapture(event.pointerId)) {
                cropViewport.releasePointerCapture(event.pointerId);
            }
            cropPointerId = null;
        };
        cropViewport.addEventListener("pointerup", releasePointer);
        cropViewport.addEventListener("pointercancel", releasePointer);
    }

    // 模块排序 — 恢复默认
    if (sectionResetBtn && !sectionResetBtn.hasAttribute(DATA_BOUND)) {
        sectionResetBtn.setAttribute(DATA_BOUND, "");
        sectionResetBtn.addEventListener("click", () => {
            fillSectionOrder(null);
            setSectionMsg(t(I18nKey.meHomepageSectionResetPendingSave));
        });
    }

    // 模块排序 — 保存
    if (sectionSaveBtn && !sectionSaveBtn.hasAttribute(DATA_BOUND)) {
        sectionSaveBtn.setAttribute(DATA_BOUND, "");
        sectionSaveBtn.addEventListener("click", async () => {
            setSectionMsg(t(I18nKey.commonSaving));
            await runWithTask(
                {
                    title: t(I18nKey.meHomepageSectionSavingTitle),
                    mode: "indeterminate",
                    text: t(I18nKey.commonSaving),
                },
                async ({ update }) => {
                    try {
                        const order = collectSectionOrder();
                        const isDefault =
                            order.length === DEFAULT_SECTION_ORDER.length &&
                            order.every(
                                (key, idx) =>
                                    key === DEFAULT_SECTION_ORDER[idx],
                            );
                        update({
                            text: t(I18nKey.meHomepageSectionSubmittingText),
                        });
                        const { response, data } = await api(
                            "/api/v1/me/profile",
                            {
                                method: "PATCH",
                                body: JSON.stringify({
                                    home_section_order: isDefault
                                        ? null
                                        : order,
                                }),
                            },
                        );
                        if (!response.ok || !data?.ok) {
                            setSectionMsg(
                                getErrorMessage(
                                    data,
                                    t(I18nKey.commonSaveFailed),
                                ),
                            );
                            return;
                        }
                        setSectionMsg(t(I18nKey.commonSaved));
                        update({ text: t(I18nKey.commonSaveCompleted) });
                    } catch {
                        setSectionMsg(t(I18nKey.commonSaveFailedRetry));
                    }
                },
            );
        });
    }

    if (bangumiTokenInput && !bangumiTokenInput.hasAttribute(DATA_BOUND)) {
        bangumiTokenInput.setAttribute(DATA_BOUND, "");
        bangumiTokenInput.addEventListener("input", () => {
            if (String(bangumiTokenInput.value || "").trim()) {
                bangumiTokenClearRequested = false;
            }
            refreshBangumiTokenState();
        });
    }

    if (
        bangumiClearTokenBtn &&
        !bangumiClearTokenBtn.hasAttribute(DATA_BOUND)
    ) {
        bangumiClearTokenBtn.setAttribute(DATA_BOUND, "");
        bangumiClearTokenBtn.addEventListener("click", () => {
            bangumiTokenClearRequested = true;
            if (bangumiTokenInput) {
                bangumiTokenInput.value = "";
            }
            refreshBangumiTokenState();
            setBangumiMsg(t(I18nKey.meHomepageBangumiTokenClearPending));
        });
    }

    if (bangumiForm && !bangumiForm.hasAttribute(DATA_BOUND)) {
        bangumiForm.setAttribute(DATA_BOUND, "");
        bangumiForm.addEventListener("submit", async (event: Event) => {
            event.preventDefault();
            const bangumiId = String(bangumiUsernameInput?.value || "").trim();
            if (bangumiId && !BANGUMI_ID_PATTERN.test(bangumiId)) {
                setBangumiMsg(t(I18nKey.meHomepageBangumiIdRule));
                return;
            }
            setBangumiMsg(t(I18nKey.commonSaving));
            await runWithTask(
                {
                    title: t(I18nKey.meHomepageBangumiSavingTitle),
                    mode: "indeterminate",
                    text: t(I18nKey.commonSaving),
                },
                async ({ update }) => {
                    try {
                        const payload = buildBangumiPatchPayload();
                        update({
                            text: t(I18nKey.meHomepageBangumiSubmittingText),
                        });
                        const { response, data } = await api(
                            "/api/v1/me/profile",
                            {
                                method: "PATCH",
                                body: JSON.stringify(payload),
                            },
                        );
                        if (!response.ok || !data?.ok) {
                            setBangumiMsg(
                                getErrorMessage(
                                    data,
                                    t(I18nKey.commonSaveFailed),
                                ),
                            );
                            return;
                        }
                        const profile = data.profile as
                            | Record<string, unknown>
                            | undefined;
                        fillBangumiConfig(profile);
                        setBangumiMsg(t(I18nKey.commonSaved));
                        update({ text: t(I18nKey.commonSaveCompleted) });
                    } catch {
                        setBangumiMsg(t(I18nKey.commonSaveFailedRetry));
                    }
                },
            );
        });
    }

    // ---- 初始化 ----

    resetCropState();
    updateHeaderPreview();

    const runInit = async (): Promise<void> => {
        editorSections.classList.add("hidden");
        const me = await loadAuthMe();
        if (!me.response.ok || !me.data?.ok) {
            window.location.href = buildLoginRedirectHref();
            return;
        }
        currentLoginEmail = String(
            (me.data.user as Record<string, unknown> | undefined)?.email || "",
        ).trim();

        const profileResp = await api("/api/v1/me/profile");
        if (profileResp.response.ok && profileResp.data?.ok) {
            const profile = profileResp.data.profile as
                | Record<string, unknown>
                | undefined;
            currentHeaderFileId = extractFileId(profile?.header_file);
            headerRemoved = false;
            updateHeaderPreview();

            const order = Array.isArray(profile?.home_section_order)
                ? (profile.home_section_order as string[])
                : null;
            fillSectionOrder(order);
            fillBangumiConfig(profile);
        } else {
            fillSectionOrder(null);
            fillBangumiConfig(undefined);
        }

        editorSections.classList.remove("hidden");
    };

    runInit().catch((err) => {
        console.error("[me-homepage-page] init failed", err);
    });
}
