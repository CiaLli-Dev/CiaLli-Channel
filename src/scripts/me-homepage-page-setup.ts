/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
/**
 * /me/homepage 事件绑定模块 — 将各功能区的事件注册逻辑封装为独立函数
 */

import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    finishTask,
    startTask,
    updateTask,
} from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import { buildAssetUrl } from "@/scripts/dom-helpers";
import {
    AUTH_ME_RETRY_DELAY_MS,
    CROP_ZOOM_MIN,
    DATA_BOUND,
    buildCropBlob,
    collectSectionOrderFromList,
    computeClampedOffset,
    computeScaleFromZoom,
    createSectionRowEl,
    fillSectionOrderList,
    measureCropViewportSize,
    toSafeFileLabel,
    validateCropFile,
    refreshBangumiTokenState,
    fillBangumiConfig,
    saveSectionOrder,
    saveBangumiConfig,
    type PageDomRefs,
    type PageState,
    type TaskHandles,
} from "@/scripts/me-homepage-page-helpers";

export type { PageDomRefs, PageState, TaskHandles };
export { fillBangumiConfig, fillSectionOrderList };

// ---------------------------------------------------------------------------
// 内部辅助：更新头图预览
// ---------------------------------------------------------------------------

function updateHeaderPreview(refs: PageDomRefs, state: PageState): void {
    if (!refs.headerPreview || !refs.headerEmpty) return;
    const src =
        state.pendingHeaderUpload?.previewUrl ||
        (state.currentHeaderFileId
            ? buildAssetUrl(state.currentHeaderFileId)
            : "");
    if (src && !state.headerRemoved) {
        refs.headerPreview.src = src;
        refs.headerPreview.classList.remove("hidden");
        refs.headerEmpty.classList.add("hidden");
    } else {
        refs.headerPreview.removeAttribute("src");
        refs.headerPreview.classList.add("hidden");
        refs.headerEmpty.classList.remove("hidden");
    }
}

// ---------------------------------------------------------------------------
// 内部辅助：裁剪弹窗
// ---------------------------------------------------------------------------

function clampCropOffset(state: PageState): void {
    const result = computeClampedOffset(state);
    state.cropOffsetX = result.cropOffsetX;
    state.cropOffsetY = result.cropOffsetY;
}

function renderCropImage(refs: PageDomRefs, state: PageState): void {
    if (!refs.cropImage) return;
    if (!state.cropLoaded) {
        refs.cropImage.classList.add("hidden");
        if (refs.cropEmpty) refs.cropEmpty.classList.remove("hidden");
        return;
    }
    clampCropOffset(state);
    refs.cropImage.classList.remove("hidden");
    refs.cropImage.style.width = `${state.cropImageWidth}px`;
    refs.cropImage.style.height = `${state.cropImageHeight}px`;
    refs.cropImage.style.transformOrigin = "top left";
    refs.cropImage.style.transform = `translate3d(${state.cropOffsetX}px, ${state.cropOffsetY}px, 0) scale(${state.cropScale})`;
    if (refs.cropEmpty) refs.cropEmpty.classList.add("hidden");
}

function updateCropApplyState(refs: PageDomRefs, state: PageState): void {
    if (refs.cropApplyBtn) {
        refs.cropApplyBtn.disabled = !state.cropLoaded || state.cropUploading;
        refs.cropApplyBtn.textContent = state.cropUploading
            ? t(I18nKey.interactionCommonProcessing)
            : t(I18nKey.interactionCommonApplyCrop);
    }
}

function revokeCropObjectUrl(state: PageState): void {
    if (state.cropObjectUrl) {
        URL.revokeObjectURL(state.cropObjectUrl);
        state.cropObjectUrl = "";
    }
}

function resetCropState(refs: PageDomRefs, state: PageState): void {
    revokeCropObjectUrl(state);
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
    if (refs.cropImage) {
        refs.cropImage.removeAttribute("src");
        refs.cropImage.classList.add("hidden");
        refs.cropImage.style.transform = "";
        refs.cropImage.style.width = "";
        refs.cropImage.style.height = "";
        refs.cropImage.style.transformOrigin = "top left";
    }
    if (refs.cropZoomInput) refs.cropZoomInput.value = String(CROP_ZOOM_MIN);
    if (refs.cropEmpty) refs.cropEmpty.classList.remove("hidden");
    updateCropApplyState(refs, state);
}

function openCropModal(refs: PageDomRefs): void {
    if (!refs.cropModal) {
        if (refs.headerMsg)
            refs.headerMsg.textContent = t(I18nKey.meHomepageCropInitFailed);
        return;
    }
    refs.cropModal.classList.remove("hidden");
    refs.cropModal.classList.add("flex");
    document.body.classList.add("overflow-hidden");
    refs.cropModal.focus();
}

function closeCropModal(refs: PageDomRefs, state: PageState): void {
    if (!refs.cropModal) return;
    refs.cropModal.classList.remove("flex");
    refs.cropModal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    if (refs.cropFileInput) refs.cropFileInput.value = "";
    resetCropState(refs, state);
    state.cropUploading = false;
    updateCropApplyState(refs, state);
    if (refs.cropMsgEl) refs.cropMsgEl.textContent = "";
}

function loadCropFile(file: File, refs: PageDomRefs, state: PageState): void {
    if (!refs.cropImage) {
        if (refs.cropMsgEl)
            refs.cropMsgEl.textContent = t(I18nKey.meHomepageCropInitFailed);
        return;
    }
    const validationError = validateCropFile(file);
    if (validationError) {
        if (refs.cropMsgEl) refs.cropMsgEl.textContent = validationError;
        return;
    }
    if (refs.cropMsgEl) refs.cropMsgEl.textContent = "";
    const nextObjectUrl = URL.createObjectURL(file);
    const img = refs.cropImage;
    img.onload = () => {
        state.cropLoaded = true;
        state.cropImageWidth = Math.max(1, img.naturalWidth);
        state.cropImageHeight = Math.max(1, img.naturalHeight);
        const size = measureCropViewportSize(refs.cropViewport);
        state.cropViewportWidth = size.width || 600;
        state.cropViewportHeight = size.height || 200;
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
        if (refs.cropZoomInput)
            refs.cropZoomInput.value = String(CROP_ZOOM_MIN);
        renderCropImage(refs, state);
        updateCropApplyState(refs, state);
    };
    img.onerror = () => {
        if (refs.cropMsgEl)
            refs.cropMsgEl.textContent = t(
                I18nKey.interactionCommonImageReadFailed,
            );
        resetCropState(refs, state);
    };
    revokeCropObjectUrl(state);
    state.cropObjectUrl = nextObjectUrl;
    img.src = nextObjectUrl;
}

function setCropScaleFromZoom(
    zoomPercent: number,
    anchorX: number,
    anchorY: number,
    refs: PageDomRefs,
    state: PageState,
): void {
    const result = computeScaleFromZoom(zoomPercent, anchorX, anchorY, state);
    if (!result) return;
    state.cropScale = result.cropScale;
    state.cropOffsetX = result.cropOffsetX;
    state.cropOffsetY = result.cropOffsetY;
    renderCropImage(refs, state);
    if (refs.cropZoomInput)
        refs.cropZoomInput.value = String(Math.round(result.normalizedZoom));
}

async function applyHeaderFromCrop(
    refs: PageDomRefs,
    state: PageState,
): Promise<void> {
    if (!state.cropLoaded || !refs.cropImage) {
        if (refs.cropMsgEl)
            refs.cropMsgEl.textContent = t(I18nKey.meHomepageHeaderSelectFirst);
        return;
    }
    state.cropUploading = true;
    updateCropApplyState(refs, state);
    try {
        const croppedBlob = await buildCropBlob(refs.cropImage, state);
        if (!croppedBlob) {
            if (refs.cropMsgEl)
                refs.cropMsgEl.textContent = t(
                    I18nKey.meHomepageHeaderCropFailed,
                );
            return;
        }
        if (state.pendingHeaderUpload)
            URL.revokeObjectURL(state.pendingHeaderUpload.previewUrl);
        state.pendingHeaderUpload = {
            blob: croppedBlob,
            previewUrl: URL.createObjectURL(croppedBlob),
        };
        state.headerRemoved = false;
        state.currentHeaderFileId = "";
        updateHeaderPreview(refs, state);
        closeCropModal(refs, state);
        if (refs.headerMsg)
            refs.headerMsg.textContent = t(
                I18nKey.meHomepageHeaderUpdatedPendingSave,
            );
    } finally {
        state.cropUploading = false;
        updateCropApplyState(refs, state);
    }
}

// ---------------------------------------------------------------------------
// 内部辅助：头图保存
// ---------------------------------------------------------------------------

async function uploadHeaderImage(
    refs: PageDomRefs,
    state: PageState,
    handles: TaskHandles,
): Promise<string | null> {
    if (!state.pendingHeaderUpload || handles.headerSaveTaskHandle === null)
        return null;
    updateTask(handles.headerSaveTaskHandle, {
        text: t(I18nKey.meHomepageHeaderUploadingText),
    });
    const formData = new FormData();
    const headerTitleBase = `Header-${toSafeFileLabel(state.currentLoginEmail || "unknown")}`;
    formData.append(
        "file",
        state.pendingHeaderUpload.blob,
        `${headerTitleBase}.jpg`,
    );
    formData.append("title", headerTitleBase);
    formData.append("purpose", "banner");
    const uploadResult = await api("/api/v1/uploads", {
        method: "POST",
        body: formData,
    });
    const fileRecord = uploadResult.data?.file as
        | Record<string, unknown>
        | undefined;
    if (
        !uploadResult.response.ok ||
        !uploadResult.data?.ok ||
        !fileRecord?.id
    ) {
        if (refs.headerMsg) {
            refs.headerMsg.textContent = getApiErrorMessage(
                uploadResult.data,
                t(I18nKey.meHomepageHeaderUploadFailed),
            );
        }
        return null;
    }
    const fileId = String(fileRecord.id);
    if (state.pendingHeaderUpload) {
        URL.revokeObjectURL(state.pendingHeaderUpload.previewUrl);
        state.pendingHeaderUpload = null;
    }
    state.currentHeaderFileId = fileId;
    return fileId;
}

async function patchHeaderFile(
    fileId: string | null,
    refs: PageDomRefs,
    state: PageState,
    handles: TaskHandles,
): Promise<void> {
    if (handles.headerSaveTaskHandle !== null) {
        updateTask(handles.headerSaveTaskHandle, {
            text: t(I18nKey.meHomepageConfigSavingText),
        });
    }
    const { response, data } = await api("/api/v1/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ header_file: fileId }),
    });
    if (!response.ok || !data?.ok) {
        if (refs.headerMsg)
            refs.headerMsg.textContent = getApiErrorMessage(
                data,
                t(I18nKey.interactionCommonSaveFailed),
            );
        return;
    }
    state.headerRemoved = false;
    state.currentHeaderFileId = fileId ?? "";
    updateHeaderPreview(refs, state);
    if (refs.headerMsg)
        refs.headerMsg.textContent = t(I18nKey.interactionCommonSaved);
    if (handles.headerSaveTaskHandle !== null) {
        updateTask(handles.headerSaveTaskHandle, {
            text: t(I18nKey.interactionCommonSaveCompleted),
        });
    }
}

async function doHeaderSave(
    refs: PageDomRefs,
    state: PageState,
    handles: TaskHandles,
): Promise<void> {
    if (state.pendingHeaderUpload) {
        const fileId = await uploadHeaderImage(refs, state, handles);
        if (fileId === null) return;
        await patchHeaderFile(fileId, refs, state, handles);
        return;
    } else if (state.headerRemoved) {
        await patchHeaderFile(null, refs, state, handles);
        return;
    } else {
        if (refs.headerMsg)
            refs.headerMsg.textContent = t(
                I18nKey.interactionCommonNoChangesToSave,
            );
        return;
    }
}

async function handleHeaderSave(
    refs: PageDomRefs,
    state: PageState,
    handles: TaskHandles,
): Promise<void> {
    if (refs.headerMsg)
        refs.headerMsg.textContent = t(I18nKey.interactionCommonSaving);
    if (handles.headerSaveTaskHandle !== null)
        finishTask(handles.headerSaveTaskHandle);
    handles.headerSaveTaskHandle = startTask({
        title: t(I18nKey.meHomepageHeaderSavingTitle),
        mode: "indeterminate",
        text: t(I18nKey.meHomepageHeaderSavingText),
    });
    try {
        await doHeaderSave(refs, state, handles);
    } catch {
        if (refs.headerMsg)
            refs.headerMsg.textContent = t(
                I18nKey.interactionCommonSaveFailedRetry,
            );
    } finally {
        if (handles.headerSaveTaskHandle !== null) {
            finishTask(handles.headerSaveTaskHandle);
            handles.headerSaveTaskHandle = null;
        }
    }
}

// ---------------------------------------------------------------------------
// 公开：事件注册函数
// ---------------------------------------------------------------------------

export function setupHeaderEvents(
    refs: PageDomRefs,
    state: PageState,
    handles: TaskHandles,
): void {
    if (
        refs.headerPreviewArea &&
        !refs.headerPreviewArea.hasAttribute(DATA_BOUND)
    ) {
        refs.headerPreviewArea.setAttribute(DATA_BOUND, "");
        refs.headerPreviewArea.addEventListener("click", () => {
            openCropModal(refs);
            if (refs.headerMsg) refs.headerMsg.textContent = "";
        });
    }
    if (
        refs.headerChangeBtn &&
        !refs.headerChangeBtn.hasAttribute(DATA_BOUND)
    ) {
        refs.headerChangeBtn.setAttribute(DATA_BOUND, "");
        refs.headerChangeBtn.addEventListener("click", () => {
            openCropModal(refs);
            if (refs.headerMsg) refs.headerMsg.textContent = "";
        });
    }
    if (
        refs.headerRemoveBtn &&
        !refs.headerRemoveBtn.hasAttribute(DATA_BOUND)
    ) {
        refs.headerRemoveBtn.setAttribute(DATA_BOUND, "");
        refs.headerRemoveBtn.addEventListener("click", () => {
            if (state.pendingHeaderUpload) {
                URL.revokeObjectURL(state.pendingHeaderUpload.previewUrl);
                state.pendingHeaderUpload = null;
            }
            state.currentHeaderFileId = "";
            state.headerRemoved = true;
            updateHeaderPreview(refs, state);
            if (refs.headerMsg)
                refs.headerMsg.textContent = t(
                    I18nKey.meHomepageHeaderRemovedPendingSave,
                );
        });
    }
    if (refs.headerSaveBtn && !refs.headerSaveBtn.hasAttribute(DATA_BOUND)) {
        refs.headerSaveBtn.setAttribute(DATA_BOUND, "");
        refs.headerSaveBtn.addEventListener("click", () => {
            void handleHeaderSave(refs, state, handles);
        });
    }
}

export function setupCropEvents(refs: PageDomRefs, state: PageState): void {
    if (refs.cropSelectBtn && !refs.cropSelectBtn.hasAttribute(DATA_BOUND)) {
        refs.cropSelectBtn.setAttribute(DATA_BOUND, "");
        refs.cropSelectBtn.addEventListener("click", () => {
            if (refs.cropFileInput) refs.cropFileInput.click();
        });
    }
    if (refs.cropFileInput && !refs.cropFileInput.hasAttribute(DATA_BOUND)) {
        refs.cropFileInput.setAttribute(DATA_BOUND, "");
        refs.cropFileInput.addEventListener("change", () => {
            const file = refs.cropFileInput?.files?.[0];
            if (file) loadCropFile(file, refs, state);
        });
    }
    if (refs.cropZoomInput && !refs.cropZoomInput.hasAttribute(DATA_BOUND)) {
        refs.cropZoomInput.setAttribute(DATA_BOUND, "");
        refs.cropZoomInput.addEventListener("input", () => {
            const zoom = Number.parseFloat(
                refs.cropZoomInput?.value || String(CROP_ZOOM_MIN),
            );
            const anchorX =
                state.cropViewportWidth > 0 ? state.cropViewportWidth / 2 : 0;
            const anchorY =
                state.cropViewportHeight > 0 ? state.cropViewportHeight / 2 : 0;
            setCropScaleFromZoom(zoom, anchorX, anchorY, refs, state);
        });
    }
    if (refs.cropApplyBtn && !refs.cropApplyBtn.hasAttribute(DATA_BOUND)) {
        refs.cropApplyBtn.setAttribute(DATA_BOUND, "");
        refs.cropApplyBtn.addEventListener("click", () => {
            void applyHeaderFromCrop(refs, state);
        });
    }
    if (refs.cropCancelBtn && !refs.cropCancelBtn.hasAttribute(DATA_BOUND)) {
        refs.cropCancelBtn.setAttribute(DATA_BOUND, "");
        refs.cropCancelBtn.addEventListener("click", () => {
            if (!state.cropUploading) closeCropModal(refs, state);
        });
    }
    if (refs.cropModal && !refs.cropModal.hasAttribute(DATA_BOUND)) {
        refs.cropModal.setAttribute(DATA_BOUND, "");
        refs.cropModal.addEventListener("click", (event: MouseEvent) => {
            if (!state.cropUploading && event.target === refs.cropModal)
                closeCropModal(refs, state);
        });
        refs.cropModal.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape" && !state.cropUploading)
                closeCropModal(refs, state);
        });
    }
    if (refs.cropViewport && !refs.cropViewport.hasAttribute(DATA_BOUND)) {
        setupCropPointerEvents(refs.cropViewport, refs, state);
    }
}

function setupCropPointerEvents(
    viewport: HTMLElement,
    refs: PageDomRefs,
    state: PageState,
): void {
    viewport.setAttribute(DATA_BOUND, "");
    viewport.addEventListener("pointerdown", (event: PointerEvent) => {
        if (!state.cropLoaded) return;
        state.cropPointerId = event.pointerId;
        state.cropPointerX = event.clientX;
        state.cropPointerY = event.clientY;
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    viewport.addEventListener("pointermove", (event: PointerEvent) => {
        if (!state.cropLoaded || state.cropPointerId !== event.pointerId)
            return;
        state.cropOffsetX += event.clientX - state.cropPointerX;
        state.cropOffsetY += event.clientY - state.cropPointerY;
        state.cropPointerX = event.clientX;
        state.cropPointerY = event.clientY;
        renderCropImage(refs, state);
        event.preventDefault();
    });
    const releasePointer = (event: PointerEvent): void => {
        if (state.cropPointerId !== event.pointerId) return;
        if (viewport.hasPointerCapture(event.pointerId))
            viewport.releasePointerCapture(event.pointerId);
        state.cropPointerId = null;
    };
    viewport.addEventListener("pointerup", releasePointer);
    viewport.addEventListener("pointercancel", releasePointer);
}

export function setupSectionEvents(refs: PageDomRefs, state: PageState): void {
    if (
        refs.sectionResetBtn &&
        !refs.sectionResetBtn.hasAttribute(DATA_BOUND)
    ) {
        refs.sectionResetBtn.setAttribute(DATA_BOUND, "");
        refs.sectionResetBtn.addEventListener("click", () => {
            fillSectionList(refs, state, null);
            if (refs.sectionMsg)
                refs.sectionMsg.textContent = t(
                    I18nKey.meHomepageSectionResetPendingSave,
                );
        });
    }
    if (refs.sectionSaveBtn && !refs.sectionSaveBtn.hasAttribute(DATA_BOUND)) {
        refs.sectionSaveBtn.setAttribute(DATA_BOUND, "");
        refs.sectionSaveBtn.addEventListener("click", () => {
            void saveSectionOrder(refs);
        });
    }
}

export function setupBangumiEvents(refs: PageDomRefs, state: PageState): void {
    if (
        refs.bangumiTokenInput &&
        !refs.bangumiTokenInput.hasAttribute(DATA_BOUND)
    ) {
        refs.bangumiTokenInput.setAttribute(DATA_BOUND, "");
        refs.bangumiTokenInput.addEventListener("input", () => {
            if (String(refs.bangumiTokenInput?.value || "").trim())
                state.bangumiTokenClearRequested = false;
            refreshBangumiTokenState(refs, state);
        });
    }
    if (
        refs.bangumiClearTokenBtn &&
        !refs.bangumiClearTokenBtn.hasAttribute(DATA_BOUND)
    ) {
        refs.bangumiClearTokenBtn.setAttribute(DATA_BOUND, "");
        refs.bangumiClearTokenBtn.addEventListener("click", () => {
            state.bangumiTokenClearRequested = true;
            if (refs.bangumiTokenInput) refs.bangumiTokenInput.value = "";
            refreshBangumiTokenState(refs, state);
            if (refs.bangumiMsg)
                refs.bangumiMsg.textContent = t(
                    I18nKey.meHomepageBangumiTokenClearPending,
                );
        });
    }
    if (refs.bangumiForm && !refs.bangumiForm.hasAttribute(DATA_BOUND)) {
        refs.bangumiForm.setAttribute(DATA_BOUND, "");
        refs.bangumiForm.addEventListener("submit", (event: Event) => {
            event.preventDefault();
            void saveBangumiConfig(refs, state);
        });
    }
}

export function fillSectionList(
    refs: PageDomRefs,
    state: PageState,
    order: string[] | null,
): void {
    if (!refs.sectionOrderList) return;
    const makeRow = (key: string): HTMLElement =>
        createSectionRowEl(
            key,
            refs.sectionOrderList!,
            () => state.sectionDragSource,
            (el) => {
                state.sectionDragSource = el;
            },
        );
    fillSectionOrderList(refs.sectionOrderList, order, makeRow);
}

export function initCropState(refs: PageDomRefs, state: PageState): void {
    resetCropState(refs, state);
    updateHeaderPreview(refs, state);
}

void AUTH_ME_RETRY_DELAY_MS; // 确保 import 被使用（实际用在 helpers 中）
void collectSectionOrderFromList; // 确保 import 被使用
