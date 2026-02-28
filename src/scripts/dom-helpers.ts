/**
 * 前端共享 DOM / 数值 / 资源工具函数。
 *
 * 从 site-settings-page.ts、me-page.ts、me-homepage-page.ts、image-crop-modal.ts
 * 中提取的公共逻辑，避免跨脚本的重复定义。
 */

// ---------------------------------------------------------------------------
// DOM 查询 & 赋值
// ---------------------------------------------------------------------------

export const el = (id: string): HTMLElement | null =>
    document.getElementById(id);

export const inputVal = (id: string): string =>
    String((el(id) as HTMLInputElement | null)?.value ?? "").trim();

export const textareaVal = (id: string): string =>
    String((el(id) as HTMLTextAreaElement | null)?.value ?? "");

export const checked = (id: string): boolean =>
    Boolean((el(id) as HTMLInputElement | null)?.checked);

export const setVal = (id: string, value: string): void => {
    const node = el(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (node) {
        node.value = value;
    }
};

export const setChecked = (id: string, value: boolean): void => {
    const node = el(id) as HTMLInputElement | null;
    if (node) {
        node.checked = value;
    }
};

export const setSelect = (id: string, value: string): void => {
    const node = el(id) as HTMLSelectElement | null;
    if (node) {
        node.value = value;
    }
};

export const setMsg = (id: string, text: string): void => {
    const node = el(id);
    if (node) {
        node.textContent = text;
    }
};

// ---------------------------------------------------------------------------
// 数值工具
// ---------------------------------------------------------------------------

export const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

export const numberOrFallback = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

// ---------------------------------------------------------------------------
// 资源 URL / 文件 ID
// ---------------------------------------------------------------------------

export const buildAssetUrl = (fileId: string): string => {
    const normalized = String(fileId || "").trim();
    if (!normalized) {
        return "";
    }
    return `/api/v1/public/assets/${encodeURIComponent(normalized)}`;
};

export const buildLoginRedirectHref = (): string => {
    const pathname = String(window.location.pathname || "/");
    const search = String(window.location.search || "");
    const hash = String(window.location.hash || "");
    const redirect = `${pathname}${search}${hash}` || "/";
    if (!redirect.startsWith("/") || redirect.startsWith("//")) {
        return "/auth/login";
    }
    return `/auth/login?redirect=${encodeURIComponent(redirect)}`;
};

export const extractFileId = (value: unknown): string => {
    if (!value) {
        return "";
    }
    if (typeof value === "string") {
        return value.trim();
    }
    if (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof (value as { id: unknown }).id === "string"
    ) {
        return String((value as { id: string }).id || "").trim();
    }
    return "";
};
