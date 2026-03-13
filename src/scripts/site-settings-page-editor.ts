/**
 * site-settings-page 的编辑器模块。
 *
 * 包含导航链接编辑器、banner/favicon 图片编辑器相关工具函数，
 * 以保持主 helpers 文件行数在 ESLint 限制内。
 */

import type { UploadPurpose } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";

// ---------------------------------------------------------------------------
// 共享常量
// ---------------------------------------------------------------------------

export const DATA_BOUND = "data-ss-bound";

export const DIRECTUS_FILE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isLikelyDirectusFileId = (value: string): boolean =>
    DIRECTUS_FILE_ID_PATTERN.test(value);

export const resolveAssetPreviewUrl = (value: string): string => {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    if (isLikelyDirectusFileId(raw)) {
        const baseUrl =
            typeof window !== "undefined" &&
            (window as Window & { __DIRECTUS_URL__?: string }).__DIRECTUS_URL__
                ? (window as Window & { __DIRECTUS_URL__?: string })
                      .__DIRECTUS_URL__
                : "";
        return `${baseUrl}/assets/${raw}`;
    }
    if (raw.startsWith("/")) {
        return raw;
    }
    if (raw.startsWith("assets/")) {
        return `/${raw}`;
    }
    return raw;
};

// ---------------------------------------------------------------------------
// 通用 CSS 类名常量
// ---------------------------------------------------------------------------

export const INPUT_CLS =
    "rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent placeholder:text-50";
export const BTN_DELETE_CLS =
    "px-3 py-1.5 rounded-lg border border-(--line-divider) text-sm text-75 hover:text-red-500 hover:border-red-300 transition-colors";
export const DRAG_HANDLE_CLS =
    "cursor-grab active:cursor-grabbing text-30 hover:text-60 transition-colors select-none text-base leading-none";
export const PREVIEW_IMG_CLS =
    "h-20 w-36 rounded-lg border border-(--line-divider) object-cover bg-black/5";
export const PREVIEW_ICON_CLS =
    "h-15 w-15 rounded-lg border border-(--line-divider) object-contain bg-black/5";
export const CROP_ZOOM_MIN = 100;
export const CROP_ZOOM_MAX = 300;
export const CROP_OUTPUT_MAX_BYTES = 1.5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 通用拖拽工具
// ---------------------------------------------------------------------------

export const attachDragEvents = (
    row: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (e: HTMLElement | null) => void,
    container: HTMLElement,
): void => {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
        row.classList.add("opacity-40");
        e.dataTransfer?.setData("text/plain", "");
        setDragSource(row);
    });
    row.addEventListener("dragend", () => {
        row.classList.remove("opacity-40");
        setDragSource(null);
        container
            .querySelectorAll(":scope > div, :scope > .nav-child-block > div")
            .forEach((e) => ((e as HTMLElement).style.borderTop = ""));
    });
    row.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (getDragSource() && getDragSource() !== row) {
            row.style.borderTop = "2px solid var(--primary)";
        }
    });
    row.addEventListener("dragleave", () => {
        row.style.borderTop = "";
    });
    row.addEventListener("drop", (e) => {
        e.preventDefault();
        handleRowDrop(e, row, getDragSource, setDragSource);
    });
};

function handleRowDrop(
    e: DragEvent,
    row: HTMLElement,
    getDragSource: () => HTMLElement | null,
    _setDragSource: (el: HTMLElement | null) => void,
): void {
    row.style.borderTop = "";
    const src = getDragSource();
    if (!src || src === row) {
        return;
    }
    const parent = row.parentElement;
    if (!parent) {
        return;
    }
    void e;

    const srcChildBlock = src.nextElementSibling?.classList.contains(
        "nav-child-block",
    )
        ? src.nextElementSibling
        : null;

    const rowChildBlock = row.nextElementSibling?.classList.contains(
        "nav-child-block",
    )
        ? row.nextElementSibling
        : null;

    const rows = [...parent.children];
    const fromIdx = rows.indexOf(src);
    const toIdx = rows.indexOf(row);

    if (fromIdx < toIdx) {
        const anchor = rowChildBlock ?? row;
        anchor.after(src);
        if (srcChildBlock) {
            src.after(srcChildBlock);
        }
    } else {
        row.before(src);
        if (srcChildBlock) {
            src.after(srcChildBlock);
        }
    }
}

export const createAddDivider = (
    label: string,
    onClick: () => void,
): HTMLElement => {
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className =
        "flex items-center gap-2 w-full py-1.5 group/add cursor-pointer";
    const lineL = document.createElement("span");
    lineL.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    const labelEl = document.createElement("span");
    labelEl.className =
        "px-4 py-1.5 rounded-lg border border-(--line-divider) text-sm text-60 group-hover/add:border-(--primary) group-hover/add:text-(--primary) transition-colors whitespace-nowrap select-none";
    labelEl.textContent = label;
    const lineR = document.createElement("span");
    lineR.className =
        "flex-1 border-t border-dashed border-(--line-divider) group-hover/add:border-(--primary) transition-colors";
    wrap.appendChild(lineL);
    wrap.appendChild(labelEl);
    wrap.appendChild(lineR);
    wrap.addEventListener("click", onClick);
    return wrap;
};

// ---------------------------------------------------------------------------
// 图片列表编辑器（favicon 与 banner）
// ---------------------------------------------------------------------------

export type FaviconItem = {
    src: string;
    theme?: "light" | "dark";
    sizes?: string;
};

export const bannerDesktopDragSource: HTMLElement | null = null;
export let faviconListContainer: HTMLElement | null = null;
export let bannerDesktopListContainer: HTMLElement | null = null;
export let onFaviconRemoved: (() => void) | null = null;
export let onBannerRemoved: (() => void) | null = null;

export const setFaviconListContainer = (c: HTMLElement | null): void => {
    faviconListContainer = c;
};
export const setBannerDesktopListContainer = (c: HTMLElement | null): void => {
    bannerDesktopListContainer = c;
};
export const setOnFaviconRemoved = (fn: (() => void) | null): void => {
    onFaviconRemoved = fn;
};
export const setOnBannerRemoved = (fn: (() => void) | null): void => {
    onBannerRemoved = fn;
};

export type PendingCropEntry = {
    blob: Blob;
    objectUrl: string;
    titlePrefix: string;
    useSequentialName: boolean;
    useFixedName: boolean;
    container: HTMLElement | null;
    fileExt: string;
    targetFormat?: "ico";
    purpose?: UploadPurpose;
};
export const pendingCropBlobs = new Map<HTMLElement, PendingCropEntry>();

export const cleanupPendingBlob = (row: HTMLElement): void => {
    const entry = pendingCropBlobs.get(row);
    if (entry) {
        URL.revokeObjectURL(entry.objectUrl);
        pendingCropBlobs.delete(row);
    }
};

export const createDragHandle = (): HTMLElement => {
    const dragHandle = document.createElement("span");
    dragHandle.className = DRAG_HANDLE_CLS;
    dragHandle.textContent = "≡";
    dragHandle.title = t(I18nKey.meSettingsDragSort);
    return dragHandle;
};

export const updateImagePreview = (
    img: HTMLImageElement,
    value: string,
): void => {
    const resolved = resolveAssetPreviewUrl(value);
    img.src = resolved;
    img.classList.toggle("opacity-30", !resolved);
};

export const createBannerImageRow = (
    src: string,
    container: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (e: HTMLElement | null) => void,
): HTMLElement => {
    const row = document.createElement("div");
    row.className = "flex flex-wrap items-center gap-2";
    row.dataset.src = src ?? "";

    row.appendChild(createDragHandle());

    const preview = document.createElement("img");
    preview.className = PREVIEW_IMG_CLS;
    preview.alt = "Banner preview";
    row.appendChild(preview);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.interactionCommonDelete);
    removeBtn.className = BTN_DELETE_CLS;
    removeBtn.addEventListener("click", () => {
        cleanupPendingBlob(row);
        row.remove();
        onBannerRemoved?.();
    });
    row.appendChild(removeBtn);

    updateImagePreview(preview, row.dataset.src ?? "");

    attachDragEvents(row, getDragSource, setDragSource, container);

    return row;
};

export const createFaviconRow = (item: FaviconItem): HTMLElement => {
    const row = document.createElement("div");
    row.className = "flex flex-wrap items-center gap-2";
    row.dataset.src = item.src ?? "";
    row.dataset.theme = item.theme ?? "";
    row.dataset.sizes = item.sizes ?? "";

    const preview = document.createElement("img");
    preview.className = PREVIEW_ICON_CLS;
    preview.alt = "Favicon preview";
    row.appendChild(preview);

    const srcInput = document.createElement("input");
    srcInput.type = "text";
    srcInput.placeholder = t(I18nKey.adminSiteSettingsUrlOrFileId);
    srcInput.value = row.dataset.src ?? "";
    srcInput.className = `${INPUT_CLS} flex-1 min-w-[14rem]`;
    srcInput.addEventListener("input", () => {
        row.dataset.src = srcInput.value.trim();
        updateImagePreview(preview, row.dataset.src ?? "");
    });
    row.appendChild(srcInput);

    appendFaviconThemeSelect(row);
    appendFaviconSizesInput(row);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.interactionCommonDelete);
    removeBtn.className = BTN_DELETE_CLS;
    removeBtn.addEventListener("click", () => {
        cleanupPendingBlob(row);
        row.remove();
        onFaviconRemoved?.();
    });
    row.appendChild(removeBtn);

    updateImagePreview(preview, row.dataset.src ?? "");

    return row;
};

function appendFaviconThemeSelect(row: HTMLElement): void {
    const themeSelect = document.createElement("select");
    themeSelect.className = `${INPUT_CLS} w-28`;
    themeSelect.innerHTML = `
		<option value="">${t(I18nKey.adminSiteSettingsDefaultOption)}</option>
		<option value="light">light</option>
		<option value="dark">dark</option>
	`;
    themeSelect.value = row.dataset.theme ?? "";
    themeSelect.addEventListener("change", () => {
        row.dataset.theme = themeSelect.value;
    });
    row.appendChild(themeSelect);
}

function appendFaviconSizesInput(row: HTMLElement): void {
    const sizesInput = document.createElement("input");
    sizesInput.type = "text";
    sizesInput.placeholder = "sizes";
    sizesInput.value = row.dataset.sizes ?? "";
    sizesInput.className = `${INPUT_CLS} w-28`;
    sizesInput.addEventListener("input", () => {
        row.dataset.sizes = sizesInput.value.trim();
    });
    row.appendChild(sizesInput);
}

export const fillBannerList = (
    items: string[],
    container: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (e: HTMLElement | null) => void,
): void => {
    container.innerHTML = "";
    for (const src of items) {
        container.appendChild(
            createBannerImageRow(src, container, getDragSource, setDragSource),
        );
    }
};

export const fillFaviconList = (
    items: FaviconItem[],
    container: HTMLElement,
): void => {
    container.innerHTML = "";
    for (const item of items) {
        container.appendChild(createFaviconRow(item));
    }
};

export const collectBannerList = (container: HTMLElement): string[] => {
    const rows = [...container.children] as HTMLElement[];
    const values: string[] = [];
    for (const row of rows) {
        if (row.tagName === "BUTTON") {
            continue;
        }
        const value = String(row.dataset.src ?? "").trim();
        if (value) {
            values.push(value);
        }
    }
    return values;
};

export const collectFaviconList = (container: HTMLElement): FaviconItem[] => {
    const rows = [...container.children] as HTMLElement[];
    const values: FaviconItem[] = [];
    for (const row of rows) {
        if (row.tagName === "BUTTON") {
            continue;
        }
        const src = String(row.dataset.src ?? "").trim();
        if (!src) {
            continue;
        }
        const entry: FaviconItem = { src };
        if (row.dataset.theme === "light" || row.dataset.theme === "dark") {
            entry.theme = row.dataset.theme;
        }
        if (row.dataset.sizes) {
            entry.sizes = row.dataset.sizes;
        }
        values.push(entry);
    }
    return values;
};

export const normalizeBannerEditorList = (raw: unknown): string[] => {
    if (typeof raw === "string") {
        return [raw];
    }
    if (Array.isArray(raw)) {
        return raw.map(String);
    }
    return [];
};

// ---------------------------------------------------------------------------
// 上传工具 — 从 site-settings-page-upload 重新导出
// ---------------------------------------------------------------------------

export {
    uploadImageBlob,
    uploadPendingCropImages,
} from "@/scripts/site-settings-page-upload";
export type { UpdateFn } from "@/scripts/site-settings-page-upload";
