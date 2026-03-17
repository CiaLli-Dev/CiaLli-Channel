/**
 * /admin/settings/site 页面运行逻辑。
 *
 * 从原始 `<script is:inline>` 抽离，确保页面切换后可正确重新初始化，
 * 不依赖整页刷新。
 */

// ---------------------------------------------------------------------------
// 模块级工具函数（不依赖 DOM）
// ---------------------------------------------------------------------------

import type { UploadPurpose } from "@/constants/upload-limits";
import { UPLOAD_LIMITS, UPLOAD_LIMIT_LABELS } from "@/constants/upload-limits";
import I18nKey from "@/i18n/i18nKey";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import { t, tFmt } from "@/scripts/i18n-runtime";

const DATA_BOUND = "data-ss-bound";

// ---------------------------------------------------------------------------
// DOM 工具函数
// ---------------------------------------------------------------------------

const el = (id: string): HTMLElement | null => document.getElementById(id);

const inputVal = (id: string): string =>
    String((el(id) as HTMLInputElement | null)?.value ?? "").trim();

const textareaVal = (id: string): string =>
    String((el(id) as HTMLTextAreaElement | null)?.value ?? "");

const checked = (id: string): boolean =>
    Boolean((el(id) as HTMLInputElement | null)?.checked);

const setVal = (id: string, value: string): void => {
    const node = el(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (node) {
        node.value = value;
    }
};

const setChecked = (id: string, value: boolean): void => {
    const node = el(id) as HTMLInputElement | null;
    if (node) {
        node.checked = value;
    }
};

const setSelect = (id: string, value: string): void => {
    const node = el(id) as HTMLSelectElement | null;
    if (node) {
        node.value = value;
    }
};

const setMsg = (id: string, text: string): void => {
    const node = el(id);
    if (node) {
        node.textContent = text;
    }
};

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const numberOrFallback = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// ---------------------------------------------------------------------------
// 资源工具函数
// ---------------------------------------------------------------------------

const DIRECTUS_FILE_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isLikelyDirectusFileId = (value: string): boolean =>
    DIRECTUS_FILE_ID_PATTERN.test(value);

const buildAssetUrl = (fileId: string): string =>
    `/api/v1/public/assets/${encodeURIComponent(fileId)}`;

const resolveAssetPreviewUrl = (value: string): string => {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }
    if (isLikelyDirectusFileId(raw)) {
        return buildAssetUrl(raw);
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
// 可视化编辑器常量
// ---------------------------------------------------------------------------

type NavLinkItem = number | NavBarLinkObj;
interface NavBarLinkObj {
    name: string;
    url: string;
    external?: boolean;
    icon?: string;
    children?: NavLinkItem[];
}

const PRESET_TO_LINK: Record<number, NavBarLinkObj> = {
    0: { name: t(I18nKey.home), url: "/", icon: "material-symbols:home" },
    1: {
        name: t(I18nKey.archive),
        url: "/posts",
        icon: "material-symbols:archive",
    },
    2: {
        name: t(I18nKey.about),
        url: "/about",
        icon: "material-symbols:person",
    },
    3: {
        name: t(I18nKey.friends),
        url: "/friends",
        icon: "material-symbols:group",
    },
    4: {
        name: t(I18nKey.anime),
        url: "/me/#bangumi",
        icon: "material-symbols:movie",
    },
    5: {
        name: t(I18nKey.diary),
        url: "/me/#diary",
        icon: "material-symbols:book",
    },
    6: {
        name: t(I18nKey.albums),
        url: "/me/#albums",
        icon: "material-symbols:photo-library",
    },
};

const expandPreset = (item: NavLinkItem): NavBarLinkObj => {
    if (typeof item === "number") {
        return {
            ...(PRESET_TO_LINK[item] ?? {
                name: tFmt(I18nKey.siteSettingsPresetLink, { index: item }),
                url: "/",
            }),
        };
    }
    return item;
};

// 通用 CSS 类名常量
const INPUT_CLS =
    "rounded-lg border border-(--line-divider) px-3 py-2 text-sm text-75 bg-transparent placeholder:text-50";
const BTN_DELETE_CLS =
    "px-3 py-1.5 rounded-lg border border-(--line-divider) text-sm text-75 hover:text-red-500 hover:border-red-300 transition-colors";
const DRAG_HANDLE_CLS =
    "cursor-grab active:cursor-grabbing text-30 hover:text-60 transition-colors select-none text-base leading-none";
const PREVIEW_IMG_CLS =
    "h-20 w-36 rounded-lg border border-(--line-divider) object-cover bg-black/5";
const PREVIEW_ICON_CLS =
    "h-15 w-15 rounded-lg border border-(--line-divider) object-contain bg-black/5";
const CROP_ZOOM_MIN = 100;
const CROP_ZOOM_MAX = 300;
const CROP_OUTPUT_MAX_BYTES = 1.5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 通用拖拽工具
// ---------------------------------------------------------------------------

const attachDragEvents = (
    row: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
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
            .forEach((el) => ((el as HTMLElement).style.borderTop = ""));
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
        row.style.borderTop = "";
        const src = getDragSource();
        if (!src || src === row) {
            return;
        }
        const parent = row.parentElement;
        if (!parent) {
            return;
        }

        // 收集源节点及其后续子块（若存在）
        const srcChildBlock = src.nextElementSibling?.classList.contains(
            "nav-child-block",
        )
            ? src.nextElementSibling
            : null;

        // 收集目标节点后续子块，用于计算插入位置
        const rowChildBlock = row.nextElementSibling?.classList.contains(
            "nav-child-block",
        )
            ? row.nextElementSibling
            : null;

        const rows = [...parent.children];
        const fromIdx = rows.indexOf(src);
        const toIdx = rows.indexOf(row);

        if (fromIdx < toIdx) {
            // 向下移动：插入到目标节点（及其子块）之后
            const anchor = rowChildBlock ?? row;
            anchor.after(src);
            if (srcChildBlock) {
                src.after(srcChildBlock);
            }
        } else {
            // 向上移动：插入到目标节点之前
            row.before(src);
            if (srcChildBlock) {
                src.after(srcChildBlock);
            }
        }
    });
};

const createAddDivider = (label: string, onClick: () => void): HTMLElement => {
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
// 导航链接编辑器
// ---------------------------------------------------------------------------

let navDragSource: HTMLElement | null = null;
let navChildDragSource: HTMLElement | null = null;
let navLinksContainer: HTMLElement | null = null;

const createNavLinkRow = (
    item: NavBarLinkObj,
    isChild: boolean,
    container: HTMLElement,
): HTMLElement => {
    const row = document.createElement("div");
    row.className = `flex flex-wrap items-center gap-2 ${isChild ? "ml-8" : ""}`;

    // 拖拽手柄
    const dragHandle = document.createElement("span");
    dragHandle.className = DRAG_HANDLE_CLS;
    dragHandle.textContent = "≡";
    dragHandle.title = t(I18nKey.meSettingsDragSort);
    row.appendChild(dragHandle);

    // 名称
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t(I18nKey.siteSettingsNavNamePlaceholder);
    nameInput.value = item.name ?? "";
    nameInput.className = `${INPUT_CLS} w-24`;
    nameInput.dataset.navField = "name";
    row.appendChild(nameInput);

    // 链接
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "URL";
    urlInput.value = item.url ?? "";
    urlInput.className = `${INPUT_CLS} flex-1 min-w-[120px]`;
    urlInput.dataset.navField = "url";
    row.appendChild(urlInput);

    // 图标
    const iconInput = document.createElement("input");
    iconInput.type = "text";
    iconInput.placeholder = t(I18nKey.siteSettingsNavIconPlaceholder);
    iconInput.value = item.icon ?? "";
    iconInput.className = `${INPUT_CLS} w-36`;
    iconInput.dataset.navField = "icon";
    row.appendChild(iconInput);

    // 外链开关
    const extLabel = document.createElement("label");
    extLabel.className =
        "flex items-center gap-2 text-xs text-60 cursor-pointer select-none";
    const extCheck = document.createElement("input");
    extCheck.type = "checkbox";
    extCheck.className = "toggle-checkbox";
    extCheck.checked = item.external ?? false;
    extCheck.dataset.navField = "external";
    const track = document.createElement("span");
    track.className = "toggle-track";
    const knob = document.createElement("span");
    knob.className = "toggle-knob";
    track.appendChild(knob);
    extLabel.appendChild(extCheck);
    extLabel.appendChild(track);
    extLabel.appendChild(
        document.createTextNode(t(I18nKey.siteSettingsExternalLink)),
    );
    row.appendChild(extLabel);

    // 子级开关按钮（仅顶层）
    if (!isChild) {
        const childToggle = document.createElement("button");
        childToggle.type = "button";
        childToggle.className =
            "nav-child-toggle px-2 py-1.5 rounded-lg border border-(--line-divider) text-xs text-75 hover:border-(--primary) hover:text-(--primary) transition-colors";
        childToggle.textContent = t(I18nKey.siteSettingsAddSubmenu);
        childToggle.title = t(I18nKey.siteSettingsAddSubmenu);
        childToggle.addEventListener("click", () => {
            const block = createNavChildrenBlock([]);
            row.after(block);
            childToggle.classList.add("hidden");
        });
        row.appendChild(childToggle);
    }

    // 删除按钮
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.commonDelete);
    removeBtn.className = BTN_DELETE_CLS;
    removeBtn.addEventListener("click", () => {
        const nextSibling = row.nextElementSibling;
        if (nextSibling && nextSibling.classList.contains("nav-child-block")) {
            nextSibling.remove();
        }
        row.remove();
    });
    row.appendChild(removeBtn);

    // 拖拽事件
    if (isChild) {
        attachDragEvents(
            row,
            () => navChildDragSource,
            (el) => {
                navChildDragSource = el;
            },
            container,
        );
    } else {
        attachDragEvents(
            row,
            () => navDragSource,
            (el) => {
                navDragSource = el;
            },
            container,
        );
    }

    return row;
};

const createNavChildrenBlock = (children: NavLinkItem[]): HTMLElement => {
    const block = document.createElement("div");
    block.className =
        "nav-child-block space-y-2 ml-4 pl-4 border-l-2 border-(--line-divider)";

    for (const child of children) {
        block.appendChild(createNavLinkRow(expandPreset(child), true, block));
    }

    block.appendChild(
        createAddDivider(t(I18nKey.siteSettingsAddChildLink), () => {
            const newRow = createNavLinkRow({ name: "", url: "" }, true, block);
            const divider = block.querySelector(
                ":scope > button",
            ) as HTMLElement | null;
            if (divider) {
                block.insertBefore(newRow, divider);
            } else {
                block.appendChild(newRow);
            }
        }),
    );

    return block;
};

const fillNavLinks = (links: NavLinkItem[], container: HTMLElement): void => {
    container.innerHTML = "";

    for (const item of links) {
        const expanded = expandPreset(item);
        const row = createNavLinkRow(expanded, false, container);
        container.appendChild(row);

        if (expanded.children && expanded.children.length > 0) {
            container.appendChild(createNavChildrenBlock(expanded.children));
            const toggle = row.querySelector(".nav-child-toggle");
            if (toggle) {
                toggle.classList.add("hidden");
            }
        }
    }

    container.appendChild(
        createAddDivider(t(I18nKey.siteSettingsAddNavLink), () => {
            const newRow = createNavLinkRow(
                { name: "", url: "" },
                false,
                container,
            );
            const divider = container.querySelector(
                ":scope > button",
            ) as HTMLElement | null;
            if (divider) {
                container.insertBefore(newRow, divider);
            } else {
                container.appendChild(newRow);
            }
        }),
    );
};

const collectLinkFromRow = (row: HTMLElement): NavBarLinkObj | null => {
    const name =
        (
            row.querySelector(
                '[data-nav-field="name"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const url =
        (
            row.querySelector(
                '[data-nav-field="url"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const icon =
        (
            row.querySelector(
                '[data-nav-field="icon"]',
            ) as HTMLInputElement | null
        )?.value?.trim() ?? "";
    const external = (
        row.querySelector(
            '[data-nav-field="external"]',
        ) as HTMLInputElement | null
    )?.checked;

    if (!name && !url) {
        return null;
    }

    const linkObj: NavBarLinkObj = { name, url };
    if (icon) {
        linkObj.icon = icon;
    }
    if (external) {
        linkObj.external = true;
    }
    return linkObj;
};

const collectNavLinks = (container: HTMLElement): NavBarLinkObj[] => {
    const result: NavBarLinkObj[] = [];
    const topChildren = [...container.children];

    for (let i = 0; i < topChildren.length; i++) {
        const child = topChildren[i] as HTMLElement;

        if (child.tagName === "BUTTON") {
            continue;
        }
        if (child.classList.contains("nav-child-block")) {
            continue;
        }

        const linkObj = collectLinkFromRow(child);
        if (!linkObj) {
            continue;
        }

        // 检查下一个兄弟节点是否为子级容器
        const nextSibling = topChildren[i + 1] as HTMLElement | undefined;
        if (nextSibling?.classList.contains("nav-child-block")) {
            const childLinks = collectChildLinks(nextSibling);
            if (childLinks.length > 0) {
                linkObj.children = childLinks;
            }
        }

        result.push(linkObj);
    }

    return result;
};

const collectChildLinks = (block: HTMLElement): NavBarLinkObj[] => {
    const result: NavBarLinkObj[] = [];
    for (const child of block.children) {
        const row = child as HTMLElement;
        if (row.tagName === "BUTTON") {
            continue;
        }
        const linkObj = collectLinkFromRow(row);
        if (linkObj) {
            result.push(linkObj);
        }
    }
    return result;
};

// ---------------------------------------------------------------------------
// 图片列表编辑器（favicon 与 banner）
// ---------------------------------------------------------------------------

type FaviconItem = {
    src: string;
    theme?: "light" | "dark";
    sizes?: string;
};

let bannerDesktopDragSource: HTMLElement | null = null;

let faviconListContainer: HTMLElement | null = null;
let bannerDesktopListContainer: HTMLElement | null = null;
let onFaviconRemoved: (() => void) | null = null;
let onBannerRemoved: (() => void) | null = null;

type PendingCropEntry = {
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
const pendingCropBlobs = new Map<HTMLElement, PendingCropEntry>();

const cleanupPendingBlob = (row: HTMLElement): void => {
    const entry = pendingCropBlobs.get(row);
    if (entry) {
        URL.revokeObjectURL(entry.objectUrl);
        pendingCropBlobs.delete(row);
    }
};

const createDragHandle = (): HTMLElement => {
    const dragHandle = document.createElement("span");
    dragHandle.className = DRAG_HANDLE_CLS;
    dragHandle.textContent = "≡";
    dragHandle.title = t(I18nKey.meSettingsDragSort);
    return dragHandle;
};

const updateImagePreview = (img: HTMLImageElement, value: string): void => {
    const resolved = resolveAssetPreviewUrl(value);
    img.src = resolved;
    img.classList.toggle("opacity-30", !resolved);
};

const createBannerImageRow = (
    src: string,
    container: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
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
    removeBtn.textContent = t(I18nKey.commonDelete);
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

const createFaviconRow = (item: FaviconItem): HTMLElement => {
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
    srcInput.placeholder = t(I18nKey.siteSettingsUrlOrFileId);
    srcInput.value = row.dataset.src ?? "";
    srcInput.className = `${INPUT_CLS} flex-1 min-w-[14rem]`;
    srcInput.addEventListener("input", () => {
        row.dataset.src = srcInput.value.trim();
        updateImagePreview(preview, row.dataset.src ?? "");
    });
    row.appendChild(srcInput);

    const themeSelect = document.createElement("select");
    themeSelect.className = `${INPUT_CLS} w-28`;
    themeSelect.innerHTML = `
		<option value="">${t(I18nKey.siteSettingsDefaultOption)}</option>
		<option value="light">light</option>
		<option value="dark">dark</option>
	`;
    themeSelect.value = row.dataset.theme ?? "";
    themeSelect.addEventListener("change", () => {
        row.dataset.theme = themeSelect.value;
    });
    row.appendChild(themeSelect);

    const sizesInput = document.createElement("input");
    sizesInput.type = "text";
    sizesInput.placeholder = "sizes";
    sizesInput.value = row.dataset.sizes ?? "";
    sizesInput.className = `${INPUT_CLS} w-28`;
    sizesInput.addEventListener("input", () => {
        row.dataset.sizes = sizesInput.value.trim();
    });
    row.appendChild(sizesInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t(I18nKey.commonDelete);
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

const fillBannerList = (
    items: string[],
    container: HTMLElement,
    getDragSource: () => HTMLElement | null,
    setDragSource: (el: HTMLElement | null) => void,
): void => {
    container.innerHTML = "";
    for (const src of items) {
        container.appendChild(
            createBannerImageRow(src, container, getDragSource, setDragSource),
        );
    }
};

const fillFaviconList = (
    items: FaviconItem[],
    container: HTMLElement,
): void => {
    container.innerHTML = "";
    for (const item of items) {
        container.appendChild(createFaviconRow(item));
    }
};

const collectBannerList = (container: HTMLElement): string[] => {
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

const collectFaviconList = (container: HTMLElement): FaviconItem[] => {
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

const normalizeBannerEditorList = (raw: unknown): string[] => {
    if (typeof raw === "string") {
        return [raw];
    }
    if (Array.isArray(raw)) {
        return raw.map(String);
    }
    return [];
};

const uploadImageBlob = async (
    blob: Blob,
    messageTarget: string,
    titleBase: string,
    fileExt = "jpg",
    targetFormat?: "ico",
    purpose?: UploadPurpose,
): Promise<string | null> => {
    setMsg(messageTarget, t(I18nKey.commonImageUploading));
    try {
        const formData = new FormData();
        formData.append("file", blob, `${titleBase}.${fileExt}`);
        formData.append("title", titleBase);
        if (targetFormat === "ico") {
            formData.append("target_format", "ico");
        }
        if (purpose) {
            formData.append("purpose", purpose);
        }
        const { response, data } = await api("/api/v1/uploads", {
            method: "POST",
            body: formData,
        });
        if (
            !response.ok ||
            !data?.ok ||
            !(data?.file as Record<string, unknown> | undefined)?.id
        ) {
            setMsg(
                messageTarget,
                getApiErrorMessage(
                    data,
                    t(I18nKey.commonImageUploadFailedRetry),
                ),
            );
            return null;
        }
        setMsg(messageTarget, "");
        return String((data.file as Record<string, unknown>).id || "");
    } catch (error) {
        console.error("[site-settings-page] upload failed", error);
        setMsg(messageTarget, t(I18nKey.commonImageUploadFailedRetry));
        return null;
    }
};

// ---------------------------------------------------------------------------
// 设置项与 DOM 的双向映射
// ---------------------------------------------------------------------------

type SettingsObj = Record<string, unknown>;

const bindSettings = (s: SettingsObj): void => {
    const site = (s.site ?? {}) as SettingsObj;
    const profile = (s.profile ?? {}) as SettingsObj;
    const navbarTitle = (s.navbarTitle ?? {}) as SettingsObj;
    const wallpaperMode = (s.wallpaperMode ?? {}) as SettingsObj;
    const banner = (s.banner ?? {}) as SettingsObj;
    const bannerCarousel = (banner.carousel ?? {}) as SettingsObj;
    const bannerWaves = (banner.waves ?? {}) as SettingsObj;
    const bannerImageApi = (banner.imageApi ?? {}) as SettingsObj;
    const bannerNavbar = (banner.navbar ?? {}) as SettingsObj;
    const bannerHomeText = (banner.homeText ?? {}) as SettingsObj;
    const bannerHomeTypewriter = (bannerHomeText.typewriter ??
        {}) as SettingsObj;
    const toc = (s.toc ?? {}) as SettingsObj;
    const license = (s.license ?? {}) as SettingsObj;
    const musicPlayer = (s.musicPlayer ?? {}) as SettingsObj;
    const sakura = (s.sakura ?? {}) as SettingsObj;
    const umami = (s.umami ?? {}) as SettingsObj;
    const analytics = (s.analytics ?? {}) as SettingsObj;
    const navBar = (s.navBar ?? {}) as SettingsObj;

    // 分区 1：站点信息（含统计）
    setVal("ss-title", String(site.title ?? ""));
    setVal("ss-subtitle", String(site.subtitle ?? ""));
    setSelect("ss-language", String(site.lang ?? "zh_CN"));
    setVal(
        "ss-keywords",
        Array.isArray(site.keywords)
            ? (site.keywords as string[]).join(", ")
            : "",
    );
    setVal("ss-start-date", String(site.siteStartDate ?? ""));
    setVal("ss-profile-name", String(profile.name ?? ""));
    setChecked("ss-umami-enabled", Boolean(umami.enabled));
    setVal("ss-umami-url", String(umami.baseUrl ?? ""));
    setVal("ss-umami-scripts", String(umami.scripts ?? ""));
    setVal("ss-gtm-id", String(analytics.gtmId ?? ""));
    setVal("ss-clarity-id", String(analytics.clarityId ?? ""));
    if (faviconListContainer) {
        fillFaviconList(
            Array.isArray(site.favicon) ? (site.favicon as FaviconItem[]) : [],
            faviconListContainer,
        );
    }

    // 分区 2：导航栏
    setSelect("ss-navbar-mode", String(navbarTitle.mode ?? "logo"));
    setVal("ss-navbar-text", String(navbarTitle.text ?? ""));
    setVal("ss-navbar-icon", String(navbarTitle.icon ?? ""));
    setVal("ss-navbar-logo", String(navbarTitle.logo ?? ""));
    setSelect(
        "ss-navbar-transparent-mode",
        String(bannerNavbar.transparentMode ?? "semi"),
    );

    // 导航链接 → 可视化编辑器
    if (navLinksContainer) {
        fillNavLinks((navBar.links ?? []) as NavLinkItem[], navLinksContainer);
    }

    // 分区 3：首页设置
    setSelect(
        "ss-wallpaper-mode",
        String(wallpaperMode.defaultMode ?? "banner"),
    );
    setSelect("ss-banner-position", String(banner.position ?? "center"));
    setChecked(
        "ss-banner-carousel-enable",
        Boolean(bannerCarousel.enable ?? false),
    );
    setVal(
        "ss-banner-carousel-interval",
        String(bannerCarousel.interval ?? ""),
    );
    setChecked("ss-banner-image-api-enable", Boolean(bannerImageApi.enable));
    setVal("ss-banner-image-api-url", String(bannerImageApi.url ?? ""));
    setChecked("ss-banner-home-text-enable", Boolean(bannerHomeText.enable));
    setVal("ss-banner-home-text-title", String(bannerHomeText.title ?? ""));
    const homeSubtitle = bannerHomeText.subtitle;
    const subtitleLines = Array.isArray(homeSubtitle)
        ? homeSubtitle.map((item) => String(item || "").trim()).filter(Boolean)
        : String(homeSubtitle ?? "").trim()
          ? [String(homeSubtitle ?? "").trim()]
          : [];
    setVal("ss-banner-home-text-subtitle", subtitleLines.join("\n"));
    setChecked(
        "ss-banner-home-typewriter-enable",
        Boolean(bannerHomeTypewriter.enable),
    );
    setVal(
        "ss-banner-home-typewriter-speed",
        String(bannerHomeTypewriter.speed ?? ""),
    );
    setVal(
        "ss-banner-home-typewriter-delete-speed",
        String(bannerHomeTypewriter.deleteSpeed ?? ""),
    );
    setVal(
        "ss-banner-home-typewriter-pause-time",
        String(bannerHomeTypewriter.pauseTime ?? ""),
    );
    setChecked("ss-banner-waves-enable", Boolean(bannerWaves.enable));
    setChecked(
        "ss-banner-waves-performance",
        Boolean(bannerWaves.performanceMode),
    );
    const bannerDesktopList = normalizeBannerEditorList(banner.src);
    if (bannerDesktopListContainer) {
        fillBannerList(
            bannerDesktopList,
            bannerDesktopListContainer,
            () => bannerDesktopDragSource,
            (el) => {
                bannerDesktopDragSource = el;
            },
        );
    }

    // 分区 5：其它设置
    setChecked("ss-music-enable", Boolean(musicPlayer.enable));
    setVal("ss-music-api", String(musicPlayer.meting_api ?? ""));
    setVal("ss-music-id", String(musicPlayer.id ?? ""));
    setVal("ss-music-server", String(musicPlayer.server ?? ""));
    setVal("ss-music-type", String(musicPlayer.type ?? ""));
    setVal("ss-music-marquee", String(musicPlayer.marqueeSpeed ?? ""));
    setChecked("ss-sakura-enable", Boolean(sakura.enable));

    // 分区 4：文章设置
    setChecked("ss-toc-enable", Boolean(toc.enable));
    setChecked("ss-toc-jp", Boolean(toc.useJapaneseBadge));
    setSelect("ss-toc-mode", String(toc.mode ?? "sidebar"));
    setSelect("ss-toc-depth", String(toc.depth ?? 2));
    setChecked("ss-license-enable", Boolean(license.enable));
    setVal("ss-license-name", String(license.name ?? ""));
    setVal("ss-license-url", String(license.url ?? ""));
};

// ---------------------------------------------------------------------------
// 请求载荷收集：每个分区独立收集
// ---------------------------------------------------------------------------

const collectSitePayload = (current: SettingsObj): SettingsObj => ({
    site: {
        ...((current.site ?? {}) as SettingsObj),
        title: inputVal("ss-title"),
        subtitle: inputVal("ss-subtitle"),
        lang: inputVal("ss-language") || "zh_CN",
        keywords: inputVal("ss-keywords")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        siteStartDate: inputVal("ss-start-date") || null,
        favicon: faviconListContainer
            ? collectFaviconList(faviconListContainer)
            : ((current.site as SettingsObj | undefined)?.favicon ?? []),
    },
    profile: {
        ...((current.profile ?? {}) as SettingsObj),
        name: inputVal("ss-profile-name"),
    },
    umami: {
        enabled: checked("ss-umami-enabled"),
        baseUrl: inputVal("ss-umami-url"),
        scripts: textareaVal("ss-umami-scripts"),
    },
    analytics: {
        ...((current.analytics ?? {}) as SettingsObj),
        gtmId: inputVal("ss-gtm-id"),
        clarityId: inputVal("ss-clarity-id"),
    },
});

const collectNavPayload = (current: SettingsObj): SettingsObj => ({
    navbarTitle: {
        ...((current.navbarTitle ?? {}) as SettingsObj),
        mode: inputVal("ss-navbar-mode") || "logo",
        text: inputVal("ss-navbar-text"),
        icon: inputVal("ss-navbar-icon"),
        logo: inputVal("ss-navbar-logo"),
    },
    banner: {
        ...((current.banner ?? {}) as SettingsObj),
        navbar: {
            ...(((current.banner ?? {}) as SettingsObj).navbar ?? {}),
            transparentMode: inputVal("ss-navbar-transparent-mode") || "semi",
        },
    },
    navBar: {
        links: navLinksContainer
            ? collectNavLinks(navLinksContainer)
            : ((current.navBar as SettingsObj | undefined)?.links ?? []),
    },
});

const collectHomePayload = (current: SettingsObj): SettingsObj => {
    const currentBanner = (current.banner ?? {}) as SettingsObj;
    const currentBannerCarousel = (currentBanner.carousel ?? {}) as SettingsObj;
    const currentBannerImageApi = (currentBanner.imageApi ?? {}) as SettingsObj;
    const currentBannerHomeText = (currentBanner.homeText ?? {}) as SettingsObj;
    const currentBannerTypewriter = (currentBannerHomeText.typewriter ??
        {}) as SettingsObj;
    const currentBannerWaves = (currentBanner.waves ?? {}) as SettingsObj;

    return {
        wallpaperMode: {
            ...((current.wallpaperMode ?? {}) as SettingsObj),
            defaultMode: inputVal("ss-wallpaper-mode") || "banner",
        },
        banner: {
            ...currentBanner,
            position: inputVal("ss-banner-position") || "center",
            src: bannerDesktopListContainer
                ? collectBannerList(bannerDesktopListContainer)
                : [],
            carousel: {
                ...currentBannerCarousel,
                enable: checked("ss-banner-carousel-enable"),
                interval:
                    Number(inputVal("ss-banner-carousel-interval") || 0) ||
                    Number(currentBannerCarousel.interval ?? 5),
            },
            imageApi: {
                ...currentBannerImageApi,
                enable: checked("ss-banner-image-api-enable"),
                url: inputVal("ss-banner-image-api-url"),
            },
            homeText: {
                ...currentBannerHomeText,
                enable: checked("ss-banner-home-text-enable"),
                title: inputVal("ss-banner-home-text-title"),
                subtitle: textareaVal("ss-banner-home-text-subtitle")
                    .split(/\r?\n/u)
                    .map((item) => item.trim())
                    .filter(Boolean),
                typewriter: {
                    ...currentBannerTypewriter,
                    enable: checked("ss-banner-home-typewriter-enable"),
                    speed: numberOrFallback(
                        inputVal("ss-banner-home-typewriter-speed"),
                        100,
                    ),
                    deleteSpeed: numberOrFallback(
                        inputVal("ss-banner-home-typewriter-delete-speed"),
                        50,
                    ),
                    pauseTime: numberOrFallback(
                        inputVal("ss-banner-home-typewriter-pause-time"),
                        2000,
                    ),
                },
            },
            waves: {
                ...currentBannerWaves,
                enable: checked("ss-banner-waves-enable"),
                performanceMode: checked("ss-banner-waves-performance"),
            },
        },
    };
};

const collectOtherPayload = (current: SettingsObj): SettingsObj => {
    return {
        musicPlayer: {
            ...((current.musicPlayer ?? {}) as SettingsObj),
            enable: checked("ss-music-enable"),
            meting_api: inputVal("ss-music-api"),
            id: inputVal("ss-music-id"),
            server: inputVal("ss-music-server"),
            type: inputVal("ss-music-type"),
            marqueeSpeed: numberOrFallback(inputVal("ss-music-marquee"), 10),
        },
        sakura: {
            enable: checked("ss-sakura-enable"),
        },
    };
};

const collectFeaturePayload = (current: SettingsObj): SettingsObj => ({
    toc: {
        enable: checked("ss-toc-enable"),
        useJapaneseBadge: checked("ss-toc-jp"),
        mode: inputVal("ss-toc-mode") || "sidebar",
        depth: Number(inputVal("ss-toc-depth") || 2),
    },
    license: {
        ...((current.license ?? {}) as SettingsObj),
        enable: checked("ss-license-enable"),
        name: inputVal("ss-license-name"),
        url: inputVal("ss-license-url"),
    },
});

// ---------------------------------------------------------------------------
// initSiteSettingsPage：首屏加载与每次 astro:after-swap 后均会调用
// ---------------------------------------------------------------------------

export function initSiteSettingsPage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/admin/settings/site") {
        return;
    }

    const root = el("ss-authenticated");
    if (!root || root.hasAttribute(DATA_BOUND)) {
        return;
    }
    root.setAttribute(DATA_BOUND, "1");

    // 获取可视化编辑器容器引用
    navLinksContainer = el("ss-nav-links-list");
    faviconListContainer = el("ss-favicon-list");
    bannerDesktopListContainer = el("ss-banner-desktop-list");

    const cropModal = el("ss-image-crop-modal");
    const cropPanel = el("ss-image-crop-panel");
    const cropTitle = el("ss-image-crop-title");
    const cropHelp = el("ss-image-crop-help");
    const cropViewport = el("ss-image-crop-viewport") as HTMLElement | null;
    const cropImage = el("ss-image-crop-image") as HTMLImageElement | null;
    const cropEmpty = el("ss-image-crop-empty");
    const cropFileInput = el("ss-image-crop-file") as HTMLInputElement | null;
    const cropSelectBtn = el(
        "ss-image-crop-select-btn",
    ) as HTMLButtonElement | null;
    const cropApplyBtn = el(
        "ss-image-crop-apply-btn",
    ) as HTMLButtonElement | null;
    const cropCancelBtn = el(
        "ss-image-crop-cancel-btn",
    ) as HTMLButtonElement | null;
    const cropZoomInput = el("ss-image-crop-zoom") as HTMLInputElement | null;
    const cropMsg = el("ss-image-crop-msg");

    type CropTarget = "favicon" | "banner-desktop";
    type CropTargetConfig = {
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

    const cropTargets: Record<CropTarget, CropTargetConfig> = {
        favicon: {
            title: t(I18nKey.siteSettingsCropFaviconTitle),
            help: t(I18nKey.siteSettingsCropFaviconHelp),
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
            container: faviconListContainer,
            createRow: (value: string) => createFaviconRow({ src: value }),
        },
        "banner-desktop": {
            title: t(I18nKey.siteSettingsCropBannerTitle),
            help: t(I18nKey.siteSettingsCropBannerHelp),
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
            container: bannerDesktopListContainer,
            createRow: (value: string) =>
                createBannerImageRow(
                    value,
                    bannerDesktopListContainer as HTMLElement,
                    () => bannerDesktopDragSource,
                    (el) => {
                        bannerDesktopDragSource = el;
                    },
                ),
        },
    };

    let activeCropTarget: CropTarget | null = null;
    let cropUploading = false;
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
    let cropResizeHandlerBound = false;

    const setCropMessage = (message: string): void => {
        if (cropMsg) {
            cropMsg.textContent = message;
        }
    };

    const setCropEmptyVisible = (visible: boolean): void => {
        if (cropEmpty) {
            cropEmpty.classList.toggle("hidden", !visible);
        }
    };

    const setCropApplyEnabled = (enabled: boolean): void => {
        if (cropApplyBtn) {
            cropApplyBtn.disabled = !enabled;
        }
    };

    const updateCropApplyState = (): void => {
        setCropApplyEnabled(cropLoaded && !cropUploading);
        if (cropApplyBtn) {
            cropApplyBtn.textContent = cropUploading
                ? t(I18nKey.commonProcessing)
                : t(I18nKey.commonApplyCrop);
        }
    };

    const revokeCropObjectUrl = (): void => {
        if (cropObjectUrl) {
            URL.revokeObjectURL(cropObjectUrl);
            cropObjectUrl = "";
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
        setCropEmptyVisible(true);
        updateCropApplyState();
    };

    const applyCropViewportBounds = (config: CropTargetConfig): void => {
        if (!cropViewport) {
            return;
        }
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
    };

    const openCropModal = (target: CropTarget): void => {
        const config = cropTargets[target];
        if (!config?.container || !cropModal || !cropViewport) {
            return;
        }
        if (cropPanel) {
            cropPanel.classList.remove("max-w-xl", "max-w-2xl");
            cropPanel.classList.add(
                target === "favicon" ? "max-w-xl" : "max-w-2xl",
            );
        }
        activeCropTarget = target;
        if (cropTitle) {
            cropTitle.textContent = config.title;
        }
        if (cropHelp) {
            cropHelp.textContent = config.help;
        }
        cropViewport.style.aspectRatio = `${config.aspectWidth} / ${config.aspectHeight}`;
        applyCropViewportBounds(config);
        cropModal.classList.remove("hidden");
        cropModal.classList.add("flex");
        cropModal.focus();
        setCropMessage("");
        resetCropState();
        if (!cropResizeHandlerBound) {
            window.addEventListener("resize", () => {
                if (!activeCropTarget) {
                    return;
                }
                applyCropViewportBounds(cropTargets[activeCropTarget]);
                if (cropLoaded) {
                    renderCropImage();
                }
            });
            cropResizeHandlerBound = true;
        }
    };

    const closeCropModal = (): void => {
        if (!cropModal) {
            return;
        }
        cropModal.classList.remove("flex");
        cropModal.classList.add("hidden");
        if (cropFileInput) {
            cropFileInput.value = "";
        }
        activeCropTarget = null;
        cropUploading = false;
        resetCropState();
        setCropMessage("");
    };

    const measureCropViewport = (): void => {
        if (!cropViewport) {
            return;
        }
        const rect = cropViewport.getBoundingClientRect();
        cropViewportWidth = rect.width;
        cropViewportHeight = rect.height;
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
            setCropEmptyVisible(true);
            return;
        }
        clampCropOffset();
        cropImage.classList.remove("hidden");
        cropImage.style.width = `${cropImageWidth}px`;
        cropImage.style.height = `${cropImageHeight}px`;
        cropImage.style.transformOrigin = "top left";
        cropImage.style.transform = `translate3d(${cropOffsetX}px, ${cropOffsetY}px, 0) scale(${cropScale})`;
        setCropEmptyVisible(false);
    };

    const setCropScaleFromZoom = (
        zoomValue: string,
        anchorX: number,
        anchorY: number,
    ): void => {
        if (!cropLoaded || cropViewportWidth <= 0 || cropViewportHeight <= 0) {
            return;
        }
        const normalizedZoom = clamp(
            Number.isFinite(Number(zoomValue))
                ? Number(zoomValue)
                : CROP_ZOOM_MIN,
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
            setCropMessage(t(I18nKey.siteSettingsCropInitFailed));
            return;
        }
        if (!file) {
            setCropMessage(t(I18nKey.siteSettingsSelectImageFile));
            return;
        }
        const config = activeCropTarget ? cropTargets[activeCropTarget] : null;
        const maxBytes = config?.maxInputBytes ?? UPLOAD_LIMITS.general;
        const label = config?.purpose
            ? UPLOAD_LIMIT_LABELS[config.purpose]
            : UPLOAD_LIMIT_LABELS.general;
        if (file.size > maxBytes) {
            setCropMessage(
                tFmt(I18nKey.siteSettingsImageTooLargeWithLimit, {
                    limit: label,
                }),
            );
            return;
        }
        setCropMessage("");
        const nextObjectUrl = URL.createObjectURL(file);
        const img = cropImage;
        img.onload = () => {
            cropLoaded = true;
            cropImageWidth = Math.max(1, img.naturalWidth);
            cropImageHeight = Math.max(1, img.naturalHeight);
            measureCropViewport();
            if (cropViewportWidth <= 0 || cropViewportHeight <= 0) {
                cropViewportWidth = 320;
                cropViewportHeight = 180;
            }
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
            setCropMessage(t(I18nKey.commonImageReadFailed));
            resetCropState();
        };
        revokeCropObjectUrl();
        cropObjectUrl = nextObjectUrl;
        img.src = nextObjectUrl;
    };

    const buildCropBlob = async (
        outputWidth: number,
        outputHeight: number,
        mimeType: "image/png" | "image/jpeg",
        quality?: number,
    ): Promise<Blob | null> => {
        if (
            !cropLoaded ||
            !cropImage ||
            cropViewportWidth <= 0 ||
            cropViewportHeight <= 0
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
        const ratioX = outputWidth / cropViewportWidth;
        const ratioY = outputHeight / cropViewportHeight;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
            cropImage,
            cropOffsetX * ratioX,
            cropOffsetY * ratioY,
            cropImageWidth * cropScale * ratioX,
            cropImageHeight * cropScale * ratioY,
        );
        return await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), mimeType, quality);
        });
    };

    const buildCropBlobWithLimit = async (
        outputWidth: number,
        outputHeight: number,
        mimeType: "image/png" | "image/jpeg",
    ): Promise<Blob | null> => {
        if (mimeType === "image/png") {
            const blob = await buildCropBlob(
                outputWidth,
                outputHeight,
                mimeType,
            );
            return blob && blob.size <= CROP_OUTPUT_MAX_BYTES ? blob : null;
        }
        const qualities = [0.9, 0.82, 0.75];
        for (const quality of qualities) {
            const blob = await buildCropBlob(
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
    };

    const confirmCrop = async (): Promise<void> => {
        if (!activeCropTarget) {
            return;
        }
        const config = cropTargets[activeCropTarget];
        if (!config?.container || !cropLoaded) {
            setCropMessage(t(I18nKey.siteSettingsSelectImageFile));
            return;
        }
        cropUploading = true;
        updateCropApplyState();
        try {
            const croppedBlob = await buildCropBlobWithLimit(
                config.outputWidth,
                config.outputHeight,
                config.outputMimeType,
            );
            if (!croppedBlob) {
                setCropMessage(t(I18nKey.siteSettingsCropFailedOrTooLarge));
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
                    activeCropTarget === "favicon" ? "ico" : undefined,
                purpose: config.purpose,
            });
            config.container.appendChild(row);
            closeCropModal();
        } finally {
            cropUploading = false;
            updateCropApplyState();
        }
    };

    const bindCropUploadButton = (
        buttonId: string,
        target: CropTarget,
    ): void => {
        const button = el(buttonId) as HTMLButtonElement | null;
        if (!button || button.hasAttribute(DATA_BOUND)) {
            return;
        }
        button.setAttribute(DATA_BOUND, "1");
        button.addEventListener("click", () => openCropModal(target));
    };

    let currentSettings: SettingsObj | null = null;

    // ---- load from API ----

    const loadSettings = async (): Promise<void> => {
        const { response, data } = await api("/api/v1/admin/settings/site");
        if (!response.ok || !data?.ok) {
            return;
        }
        currentSettings = (data.settings ?? {}) as SettingsObj;
        bindSettings(currentSettings);
    };

    // ---- save helper ----

    const saveSection = async (
        msgId: string,
        collectFn: (current: SettingsObj) => SettingsObj,
    ): Promise<void> => {
        if (!currentSettings) {
            return;
        }
        const settingsSnapshot = currentSettings;
        const pendingCount = pendingCropBlobs.size;
        const totalSteps = pendingCount + 1;
        setMsg(msgId, t(I18nKey.commonSaving));
        await runWithTask(
            {
                title: t(I18nKey.siteSettingsSavingTitle),
                mode: pendingCount > 0 ? "determinate" : "indeterminate",
                percent: 0,
                text:
                    pendingCount > 0
                        ? t(I18nKey.commonImageUploading)
                        : t(I18nKey.commonSaving),
            },
            async ({ update }) => {
                try {
                    let doneSteps = 0;

                    // 先上传所有待提交的裁剪图片
                    for (const [row, pending] of pendingCropBlobs) {
                        update({
                            mode:
                                pendingCount > 0
                                    ? "determinate"
                                    : "indeterminate",
                            text: t(I18nKey.commonImageUploading),
                            percent:
                                pendingCount > 0
                                    ? Math.round((doneSteps / totalSteps) * 100)
                                    : undefined,
                        });
                        const rowSiblings = pending.container
                            ? [...pending.container.children].filter(
                                  (child) =>
                                      (child as HTMLElement).tagName !==
                                      "BUTTON",
                              )
                            : [];
                        const rowIndex = rowSiblings.indexOf(row);
                        const sequence = String(
                            rowIndex >= 0 ? rowIndex + 1 : Date.now(),
                        ).padStart(2, "0");
                        const titleBase =
                            pending.useSequentialName && rowIndex >= 0
                                ? `${pending.titlePrefix}-${sequence}`
                                : pending.useFixedName
                                  ? pending.titlePrefix
                                  : `${pending.titlePrefix}-${Date.now()}`;
                        const fileId = await uploadImageBlob(
                            pending.blob,
                            msgId,
                            titleBase,
                            pending.fileExt,
                            pending.targetFormat,
                            pending.purpose,
                        );
                        if (!fileId) {
                            setMsg(
                                msgId,
                                t(I18nKey.siteSettingsUploadFailedCanceled),
                            );
                            return;
                        }
                        row.dataset.src = fileId;
                        const preview = row.querySelector("img");
                        if (preview) {
                            updateImagePreview(
                                preview as HTMLImageElement,
                                fileId,
                            );
                        }
                        const srcInput = row.querySelector(
                            'input[type="text"]',
                        ) as HTMLInputElement | null;
                        if (srcInput) {
                            srcInput.value = fileId;
                        }
                        URL.revokeObjectURL(pending.objectUrl);
                        pendingCropBlobs.delete(row);
                        doneSteps += 1;
                    }

                    update({
                        mode:
                            pendingCount > 0 ? "determinate" : "indeterminate",
                        text: t(I18nKey.siteSettingsSavingConfig),
                        percent:
                            pendingCount > 0
                                ? Math.round((doneSteps / totalSteps) * 100)
                                : undefined,
                    });
                    const sectionPayload = collectFn(settingsSnapshot);
                    const payload: SettingsObj = {
                        ...settingsSnapshot,
                        ...sectionPayload,
                    };
                    const { response, data } = await api(
                        "/api/v1/admin/settings/site",
                        {
                            method: "PATCH",
                            body: JSON.stringify(payload),
                        },
                    );
                    if (!response.ok || !data?.ok) {
                        setMsg(
                            msgId,
                            getApiErrorMessage(
                                data,
                                t(I18nKey.commonSaveFailed),
                            ),
                        );
                        return;
                    }
                    update({
                        mode:
                            pendingCount > 0 ? "determinate" : "indeterminate",
                        text: t(I18nKey.commonSaveCompletedReloading),
                        percent: pendingCount > 0 ? 100 : undefined,
                    });
                    currentSettings = (data.settings ?? payload) as SettingsObj;
                    bindSettings(currentSettings);
                    setMsg(msgId, t(I18nKey.commonSavedReloading));
                    window.setTimeout(() => {
                        window.location.reload();
                    }, 120);
                } catch (err) {
                    setMsg(
                        msgId,
                        err instanceof Error
                            ? err.message
                            : t(I18nKey.siteSettingsInvalidInput),
                    );
                }
            },
        );
    };

    onFaviconRemoved = () => {
        if (!currentSettings) {
            return;
        }
        currentSettings = {
            ...currentSettings,
            ...collectSitePayload(currentSettings),
        };
        setMsg("ss-site-msg", t(I18nKey.siteSettingsIconRemovedPendingSave));
    };
    onBannerRemoved = () => {
        if (!currentSettings) {
            return;
        }
        currentSettings = {
            ...currentSettings,
            ...collectHomePayload(currentSettings),
        };
        setMsg("ss-home-msg", t(I18nKey.siteSettingsBannerRemovedPendingSave));
    };

    // ---- form submit handlers ----

    const bindForm = (
        formId: string,
        msgId: string,
        collectFn: (current: SettingsObj) => SettingsObj,
    ): void => {
        const form = el(formId);
        if (!form || form.hasAttribute(DATA_BOUND)) {
            return;
        }
        form.setAttribute(DATA_BOUND, "1");
        form.addEventListener("submit", (event: Event) => {
            event.preventDefault();
            void saveSection(msgId, collectFn);
        });
    };

    bindForm("ss-site-form", "ss-site-msg", collectSitePayload);
    bindForm("ss-nav-form", "ss-nav-msg", collectNavPayload);
    bindForm("ss-home-form", "ss-home-msg", collectHomePayload);
    bindForm("ss-feature-form", "ss-feature-msg", collectFeaturePayload);
    bindForm("ss-other-form", "ss-other-msg", collectOtherPayload);

    // ---- image list buttons ----

    bindCropUploadButton("ss-favicon-upload-btn", "favicon");
    bindCropUploadButton("ss-banner-desktop-upload-btn", "banner-desktop");
    const faviconAddButton = el(
        "ss-favicon-add-btn",
    ) as HTMLButtonElement | null;
    if (faviconAddButton && !faviconAddButton.hasAttribute(DATA_BOUND)) {
        faviconAddButton.setAttribute(DATA_BOUND, "1");
        faviconAddButton.addEventListener("click", () => {
            if (!faviconListContainer) {
                return;
            }
            faviconListContainer.appendChild(createFaviconRow({ src: "" }));
            setMsg("ss-site-msg", t(I18nKey.siteSettingsIconAddedPendingSave));
        });
    }

    // ---- crop modal bindings ----

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
                loadCropFile(file);
            }
        });
    }

    if (cropZoomInput && !cropZoomInput.hasAttribute(DATA_BOUND)) {
        cropZoomInput.setAttribute(DATA_BOUND, "1");
        cropZoomInput.addEventListener("input", () => {
            const anchorX = cropViewportWidth > 0 ? cropViewportWidth / 2 : 0;
            const anchorY = cropViewportHeight > 0 ? cropViewportHeight / 2 : 0;
            setCropScaleFromZoom(
                cropZoomInput.value || String(CROP_ZOOM_MIN),
                anchorX,
                anchorY,
            );
        });
    }

    if (cropApplyBtn && !cropApplyBtn.hasAttribute(DATA_BOUND)) {
        cropApplyBtn.setAttribute(DATA_BOUND, "1");
        cropApplyBtn.addEventListener("click", async () => {
            await confirmCrop();
        });
    }

    if (cropCancelBtn && !cropCancelBtn.hasAttribute(DATA_BOUND)) {
        cropCancelBtn.setAttribute(DATA_BOUND, "1");
        cropCancelBtn.addEventListener("click", () => {
            if (!cropUploading) {
                closeCropModal();
            }
        });
    }

    if (cropModal && !cropModal.hasAttribute(DATA_BOUND)) {
        cropModal.setAttribute(DATA_BOUND, "1");
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
        cropViewport.setAttribute(DATA_BOUND, "1");
        cropViewport.addEventListener("pointerdown", (event: PointerEvent) => {
            if (!cropLoaded || !cropViewport) {
                return;
            }
            cropPointerId = event.pointerId;
            cropPointerX = event.clientX;
            cropPointerY = event.clientY;
            cropViewport.setPointerCapture(event.pointerId);
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

    // ---- kick off ----

    loadSettings().catch((err) => {
        console.error("[site-settings-page] init failed", err);
    });
}
