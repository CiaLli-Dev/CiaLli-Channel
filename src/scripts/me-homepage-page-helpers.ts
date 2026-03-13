/* eslint-disable max-lines -- 文件行数较长，按页面驱动与模块边界保留当前结构 */
/**
 * /me/homepage 页面辅助函数 — 纯逻辑、可共享
 */

import I18nKey from "@/i18n/i18nKey";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { clamp } from "@/scripts/dom-helpers";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";

// ---------------------------------------------------------------------------
// 常量（供主文件 re-export 或直接使用）
// ---------------------------------------------------------------------------

export const AUTH_ME_RETRY_DELAY_MS = 220;
export const HEADER_CROP_OUTPUT_WIDTH = 1200;
export const HEADER_CROP_OUTPUT_HEIGHT = 400;
export const CROP_ZOOM_MIN = 100;
export const CROP_ZOOM_MAX = 300;
export const DATA_BOUND = "data-homepage-bound";
export const BANGUMI_ID_PATTERN = /^[0-9]+$/;

export const toSafeFileLabel = (value: string): string =>
    String(value || "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ");

export const DEFAULT_SECTION_ORDER = [
    "articles",
    "diaries",
    "bangumi",
    "albums",
];

export const SECTION_LABELS: Record<string, { icon: string; name: string }> = {
    articles: { icon: "📝", name: t(I18nKey.meHomepageSectionArticles) },
    diaries: { icon: "📔", name: t(I18nKey.meHomepageSectionDiaries) },
    bangumi: { icon: "🎬", name: t(I18nKey.meHomepageSectionBangumi) },
    albums: { icon: "📷", name: t(I18nKey.meHomepageSectionAlbums) },
};

// ---------------------------------------------------------------------------
// 页面上下文对象
// ---------------------------------------------------------------------------

export interface PageDomRefs {
    editorSections: HTMLElement;
    headerPreview: HTMLImageElement | null;
    headerEmpty: HTMLElement | null;
    headerPreviewArea: HTMLElement | null;
    headerChangeBtn: HTMLElement | null;
    headerRemoveBtn: HTMLElement | null;
    headerSaveBtn: HTMLElement | null;
    headerMsg: HTMLElement | null;
    sectionOrderList: HTMLElement | null;
    sectionResetBtn: HTMLElement | null;
    sectionSaveBtn: HTMLElement | null;
    sectionMsg: HTMLElement | null;
    bangumiForm: HTMLFormElement | null;
    bangumiShowInput: HTMLInputElement | null;
    bangumiPrivateInput: HTMLInputElement | null;
    bangumiUsernameInput: HTMLInputElement | null;
    bangumiTokenInput: HTMLInputElement | null;
    bangumiTokenState: HTMLElement | null;
    bangumiClearTokenBtn: HTMLButtonElement | null;
    bangumiMsg: HTMLElement | null;
    cropModal: HTMLElement | null;
    cropViewport: HTMLElement | null;
    cropImage: HTMLImageElement | null;
    cropEmpty: HTMLElement | null;
    cropFileInput: HTMLInputElement | null;
    cropSelectBtn: HTMLElement | null;
    cropApplyBtn: HTMLButtonElement | null;
    cropCancelBtn: HTMLElement | null;
    cropZoomInput: HTMLInputElement | null;
    cropMsgEl: HTMLElement | null;
}

export interface PageState {
    currentHeaderFileId: string;
    currentLoginEmail: string;
    pendingHeaderUpload: { blob: Blob; previewUrl: string } | null;
    headerRemoved: boolean;
    bangumiTokenSet: boolean;
    bangumiTokenClearRequested: boolean;
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
    cropUploading: boolean;
    sectionDragSource: HTMLElement | null;
}

export interface TaskHandles {
    headerSaveTaskHandle:
        | import("@/scripts/progress-overlay-manager").ProgressTaskHandle
        | null;
}

// ---------------------------------------------------------------------------
// 裁剪辅助：viewport 尺寸
// ---------------------------------------------------------------------------

export function measureCropViewportSize(cropViewport: HTMLElement | null): {
    width: number;
    height: number;
} {
    if (!cropViewport) {
        return { width: 0, height: 0 };
    }
    const rect = cropViewport.getBoundingClientRect();
    return {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
    };
}

// ---------------------------------------------------------------------------
// 裁剪辅助：clamp 偏移量
// ---------------------------------------------------------------------------

export function computeClampedOffset(state: {
    cropLoaded: boolean;
    cropViewportWidth: number;
    cropViewportHeight: number;
    cropImageWidth: number;
    cropImageHeight: number;
    cropScale: number;
    cropOffsetX: number;
    cropOffsetY: number;
}): { cropOffsetX: number; cropOffsetY: number } {
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return {
            cropOffsetX: state.cropOffsetX,
            cropOffsetY: state.cropOffsetY,
        };
    }
    const minX =
        state.cropViewportWidth - state.cropImageWidth * state.cropScale;
    const minY =
        state.cropViewportHeight - state.cropImageHeight * state.cropScale;
    return {
        cropOffsetX: clamp(state.cropOffsetX, minX, 0),
        cropOffsetY: clamp(state.cropOffsetY, minY, 0),
    };
}

// ---------------------------------------------------------------------------
// 裁剪辅助：计算缩放后的新状态
// ---------------------------------------------------------------------------

export function computeScaleFromZoom(
    zoomPercent: number,
    anchorX: number,
    anchorY: number,
    state: {
        cropLoaded: boolean;
        cropViewportWidth: number;
        cropViewportHeight: number;
        cropMinScale: number;
        cropScale: number;
        cropOffsetX: number;
        cropOffsetY: number;
        cropImageWidth: number;
        cropImageHeight: number;
    },
): {
    cropScale: number;
    cropOffsetX: number;
    cropOffsetY: number;
    normalizedZoom: number;
} | null {
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return null;
    }
    const normalizedZoom = clamp(
        Number.isFinite(zoomPercent) ? zoomPercent : CROP_ZOOM_MIN,
        CROP_ZOOM_MIN,
        CROP_ZOOM_MAX,
    );
    const nextScale = state.cropMinScale * (normalizedZoom / 100);
    const safeAnchorX = clamp(anchorX, 0, state.cropViewportWidth);
    const safeAnchorY = clamp(anchorY, 0, state.cropViewportHeight);
    const imagePointX = (safeAnchorX - state.cropOffsetX) / state.cropScale;
    const imagePointY = (safeAnchorY - state.cropOffsetY) / state.cropScale;
    let newOffsetX = safeAnchorX - imagePointX * nextScale;
    let newOffsetY = safeAnchorY - imagePointY * nextScale;
    const minX = state.cropViewportWidth - state.cropImageWidth * nextScale;
    const minY = state.cropViewportHeight - state.cropImageHeight * nextScale;
    newOffsetX = clamp(newOffsetX, minX, 0);
    newOffsetY = clamp(newOffsetY, minY, 0);
    return {
        cropScale: nextScale,
        cropOffsetX: newOffsetX,
        cropOffsetY: newOffsetY,
        normalizedZoom,
    };
}

// ---------------------------------------------------------------------------
// 裁剪辅助：校验文件
// ---------------------------------------------------------------------------

export function validateCropFile(file: File): string | null {
    if (!file.type.startsWith("image/")) {
        return t(I18nKey.interactionCommonSelectImage);
    }
    if (file.size > UPLOAD_LIMITS.banner) {
        return tFmt(I18nKey.interactionCommonImageTooLarge, {
            size: UPLOAD_LIMIT_LABELS.banner,
        });
    }
    return null;
}

// ---------------------------------------------------------------------------
// 裁剪辅助：buildCropBlob
// ---------------------------------------------------------------------------

export async function buildCropBlob(
    cropImage: HTMLImageElement,
    state: {
        cropLoaded: boolean;
        cropViewportWidth: number;
        cropViewportHeight: number;
        cropOffsetX: number;
        cropOffsetY: number;
        cropImageWidth: number;
        cropImageHeight: number;
        cropScale: number;
    },
): Promise<Blob | null> {
    if (
        !state.cropLoaded ||
        state.cropViewportWidth <= 0 ||
        state.cropViewportHeight <= 0
    ) {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = HEADER_CROP_OUTPUT_WIDTH;
    canvas.height = HEADER_CROP_OUTPUT_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const ratioX = HEADER_CROP_OUTPUT_WIDTH / state.cropViewportWidth;
    const ratioY = HEADER_CROP_OUTPUT_HEIGHT / state.cropViewportHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
        cropImage,
        state.cropOffsetX * ratioX,
        state.cropOffsetY * ratioY,
        state.cropImageWidth * state.cropScale * ratioX,
        state.cropImageHeight * state.cropScale * ratioY,
    );
    return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
}

// ---------------------------------------------------------------------------
// Section 排序辅助：创建行 DOM
// ---------------------------------------------------------------------------

export function createSectionRowEl(
    key: string,
    sectionOrderList: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
): HTMLElement {
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

    bindSectionRowDragEvents(
        row,
        sectionOrderList,
        getDragSource,
        setDragSource,
    );
    return row;
}

function bindSectionRowDragEvents(
    row: HTMLElement,
    sectionOrderList: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
): void {
    row.addEventListener("dragstart", (e) => {
        row.classList.add("opacity-40");
        e.dataTransfer?.setData("text/plain", "");
        setDragSource(row);
    });
    row.addEventListener("dragend", () => {
        row.classList.remove("opacity-40");
        setDragSource(null);
        sectionOrderList
            .querySelectorAll(":scope > div")
            .forEach((el) => ((el as HTMLElement).style.borderTop = ""));
    });
    row.addEventListener("dragover", (e) => {
        e.preventDefault();
        const src = getDragSource();
        if (src && src !== row) {
            row.style.borderTop = "2px solid var(--primary)";
        }
    });
    row.addEventListener("dragleave", () => {
        row.style.borderTop = "";
    });
    row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.style.borderTop = "";
        const src = getDragSource();
        if (!src || src === row) return;
        const rows = [...sectionOrderList.children];
        const fromIdx = rows.indexOf(src);
        const toIdx = rows.indexOf(row);
        if (fromIdx < toIdx) {
            row.after(src);
        } else {
            row.before(src);
        }
    });
}

// ---------------------------------------------------------------------------
// Section 排序辅助：填充顺序
// ---------------------------------------------------------------------------

export function fillSectionOrderList(
    sectionOrderList: HTMLElement,
    order: string[] | null,
    createRow: (key: string) => HTMLElement,
): void {
    sectionOrderList.innerHTML = "";
    const sections = order ?? DEFAULT_SECTION_ORDER;
    for (const key of sections) {
        if (SECTION_LABELS[key]) {
            sectionOrderList.appendChild(createRow(key));
        }
    }
    for (const key of DEFAULT_SECTION_ORDER) {
        if (
            !sections.includes(key) &&
            !sectionOrderList.querySelector(`[data-section-key="${key}"]`)
        ) {
            sectionOrderList.appendChild(createRow(key));
        }
    }
}

// ---------------------------------------------------------------------------
// Section 排序辅助：收集顺序
// ---------------------------------------------------------------------------

export function collectSectionOrderFromList(
    sectionOrderList: HTMLElement | null,
): string[] {
    if (!sectionOrderList) return DEFAULT_SECTION_ORDER;
    const order: string[] = [];
    for (const row of sectionOrderList.querySelectorAll("[data-section-key]")) {
        const key = (row as HTMLElement).dataset.sectionKey;
        if (key) order.push(key);
    }
    return order;
}

// ---------------------------------------------------------------------------
// Bangumi 辅助：构建 PATCH payload
// ---------------------------------------------------------------------------

export function buildBangumiPatchPayload(params: {
    bangumiShowInput: HTMLInputElement | null;
    bangumiUsernameInput: HTMLInputElement | null;
    bangumiPrivateInput: HTMLInputElement | null;
    bangumiTokenInput: HTMLInputElement | null;
    bangumiTokenClearRequested: boolean;
}): Record<string, unknown> {
    const {
        bangumiShowInput,
        bangumiUsernameInput,
        bangumiPrivateInput,
        bangumiTokenInput,
        bangumiTokenClearRequested,
    } = params;
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
}

// ---------------------------------------------------------------------------
// Bangumi token 状态刷新
// ---------------------------------------------------------------------------

export function refreshBangumiTokenState(
    refs: PageDomRefs,
    state: PageState,
): void {
    if (!refs.bangumiTokenState) return;
    const editingToken = String(refs.bangumiTokenInput?.value || "").trim();
    if (state.bangumiTokenClearRequested) {
        refs.bangumiTokenState.textContent = t(
            I18nKey.meHomepageBangumiTokenWillClear,
        );
        return;
    }
    if (editingToken) {
        refs.bangumiTokenState.textContent = t(
            I18nKey.meHomepageBangumiTokenWillUpdate,
        );
        return;
    }
    refs.bangumiTokenState.textContent = state.bangumiTokenSet
        ? t(I18nKey.meHomepageBangumiTokenSet)
        : t(I18nKey.meHomepageBangumiTokenNotSet);
}

// ---------------------------------------------------------------------------
// Bangumi config 填充
// ---------------------------------------------------------------------------

export function fillBangumiConfig(
    profile: Record<string, unknown> | undefined,
    refs: PageDomRefs,
    state: PageState,
): void {
    if (refs.bangumiShowInput) {
        refs.bangumiShowInput.checked = Boolean(
            profile?.show_bangumi_on_profile ?? true,
        );
    }
    if (refs.bangumiPrivateInput) {
        refs.bangumiPrivateInput.checked = Boolean(
            profile?.bangumi_include_private ?? false,
        );
    }
    if (refs.bangumiUsernameInput) {
        refs.bangumiUsernameInput.value = String(
            profile?.bangumi_username || "",
        ).trim();
    }
    if (refs.bangumiTokenInput) refs.bangumiTokenInput.value = "";
    state.bangumiTokenSet = Boolean(profile?.bangumi_access_token_set);
    state.bangumiTokenClearRequested = false;
    refreshBangumiTokenState(refs, state);
}

// ---------------------------------------------------------------------------
// Section 保存（API 调用）
// ---------------------------------------------------------------------------

export async function saveSectionOrder(refs: PageDomRefs): Promise<void> {
    if (refs.sectionMsg)
        refs.sectionMsg.textContent = t(I18nKey.interactionCommonSaving);
    await runWithTask(
        {
            title: t(I18nKey.meHomepageSectionSavingTitle),
            mode: "indeterminate",
            text: t(I18nKey.interactionCommonSaving),
        },
        async ({ update }) => {
            try {
                const order = collectSectionOrderFromList(
                    refs.sectionOrderList,
                );
                const isDefault =
                    order.length === DEFAULT_SECTION_ORDER.length &&
                    order.every(
                        (key, idx) => key === DEFAULT_SECTION_ORDER[idx],
                    );
                update({ text: t(I18nKey.meHomepageSectionSubmittingText) });
                const { response, data } = await api("/api/v1/me/profile", {
                    method: "PATCH",
                    body: JSON.stringify({
                        home_section_order: isDefault ? null : order,
                    }),
                });
                if (!response.ok || !data?.ok) {
                    if (refs.sectionMsg) {
                        refs.sectionMsg.textContent = getApiErrorMessage(
                            data,
                            t(I18nKey.interactionCommonSaveFailed),
                        );
                    }
                    return;
                }
                if (refs.sectionMsg)
                    refs.sectionMsg.textContent = t(
                        I18nKey.interactionCommonSaved,
                    );
                update({ text: t(I18nKey.interactionCommonSaveCompleted) });
            } catch {
                if (refs.sectionMsg)
                    refs.sectionMsg.textContent = t(
                        I18nKey.interactionCommonSaveFailedRetry,
                    );
            }
        },
    );
}

// ---------------------------------------------------------------------------
// Bangumi 保存（API 调用）
// ---------------------------------------------------------------------------

export async function saveBangumiConfig(
    refs: PageDomRefs,
    state: PageState,
): Promise<void> {
    const bangumiId = String(refs.bangumiUsernameInput?.value || "").trim();
    if (bangumiId && !BANGUMI_ID_PATTERN.test(bangumiId)) {
        if (refs.bangumiMsg)
            refs.bangumiMsg.textContent = t(I18nKey.meHomepageBangumiIdRule);
        return;
    }
    if (refs.bangumiMsg)
        refs.bangumiMsg.textContent = t(I18nKey.interactionCommonSaving);
    await runWithTask(
        {
            title: t(I18nKey.meHomepageBangumiSavingTitle),
            mode: "indeterminate",
            text: t(I18nKey.interactionCommonSaving),
        },
        async ({ update }) => {
            try {
                const payload = buildBangumiPatchPayload({
                    bangumiShowInput: refs.bangumiShowInput,
                    bangumiUsernameInput: refs.bangumiUsernameInput,
                    bangumiPrivateInput: refs.bangumiPrivateInput,
                    bangumiTokenInput: refs.bangumiTokenInput,
                    bangumiTokenClearRequested:
                        state.bangumiTokenClearRequested,
                });
                update({ text: t(I18nKey.meHomepageBangumiSubmittingText) });
                const { response, data } = await api("/api/v1/me/profile", {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
                if (!response.ok || !data?.ok) {
                    if (refs.bangumiMsg) {
                        refs.bangumiMsg.textContent = getApiErrorMessage(
                            data,
                            t(I18nKey.interactionCommonSaveFailed),
                        );
                    }
                    return;
                }
                const profile = data.profile as
                    | Record<string, unknown>
                    | undefined;
                fillBangumiConfig(profile, refs, state);
                if (refs.bangumiMsg)
                    refs.bangumiMsg.textContent = t(
                        I18nKey.interactionCommonSaved,
                    );
                update({ text: t(I18nKey.interactionCommonSaveCompleted) });
            } catch {
                if (refs.bangumiMsg)
                    refs.bangumiMsg.textContent = t(
                        I18nKey.interactionCommonSaveFailedRetry,
                    );
            }
        },
    );
}

// ---------------------------------------------------------------------------
// 认证重试
// ---------------------------------------------------------------------------

export async function loadAuthMe(): Promise<
    import("@/scripts/http-client").ApiResult
> {
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
