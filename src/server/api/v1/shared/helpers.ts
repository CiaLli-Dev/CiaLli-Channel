import type { JsonObject } from "@/types/json";

const SPECIAL_ARTICLE_SLUGS = ["about", "friends"] as const;
const SPECIAL_ARTICLE_SLUG_SET = new Set<string>(SPECIAL_ARTICLE_SLUGS);

export function nowIso(): string {
    return new Date().toISOString();
}

export function sanitizeSlug(input: string): string {
    const value = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5\s\-_]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
    return value || `item-${Date.now()}`;
}

function normalizePlainSlug(input: string | null | undefined): string {
    return String(input || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5\s\-_]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
}

export function isSpecialArticleSlug(input: string): boolean {
    const normalized = normalizePlainSlug(input);
    return SPECIAL_ARTICLE_SLUG_SET.has(normalized);
}

export function toSpecialArticleSlug(
    input: string | null | undefined,
): string | null {
    const normalized = normalizePlainSlug(input);
    if (!normalized) {
        return null;
    }
    return SPECIAL_ARTICLE_SLUG_SET.has(normalized) ? normalized : null;
}

export function excludeSpecialArticleSlugFilter(): JsonObject {
    return {
        _or: [
            { slug: { _null: true } },
            { slug: { _nin: [...SPECIAL_ARTICLE_SLUGS] } },
        ],
    };
}

export function safeCsv(value: string[] | null | undefined): string[] {
    if (!value || !Array.isArray(value)) return [];
    return value.map((s) => String(s).trim()).filter(Boolean);
}

export function hasOwn<T extends object, K extends PropertyKey>(
    object: T,
    key: K,
): key is K & keyof T {
    return Object.prototype.hasOwnProperty.call(object, key);
}

export function toDirectusAssetQuery(
    query: URLSearchParams,
): Partial<Record<"width" | "height" | "fit" | "quality" | "format", string>> {
    const output: Partial<
        Record<"width" | "height" | "fit" | "quality" | "format", string>
    > = {};
    const ALLOWED_FORMATS = ["jpeg", "png", "webp", "avif", "tiff"];
    const ALLOWED_FITS = ["cover", "contain", "inside", "outside"];
    const MAX_DIMENSION = 4096;
    const widthRaw = parseInt(query.get("width") || "", 10);
    if (widthRaw > 0) {
        output.width = String(Math.min(widthRaw, MAX_DIMENSION));
    }
    const heightRaw = parseInt(query.get("height") || "", 10);
    if (heightRaw > 0) {
        output.height = String(Math.min(heightRaw, MAX_DIMENSION));
    }
    const fit = query.get("fit")?.trim() || "";
    if (fit && ALLOWED_FITS.includes(fit)) {
        output.fit = fit;
    }
    const qualityRaw = parseInt(query.get("quality") || "", 10);
    if (qualityRaw > 0) {
        output.quality = String(Math.min(Math.max(qualityRaw, 1), 100));
    }
    const format = query.get("format")?.trim() || "";
    if (format && ALLOWED_FORMATS.includes(format)) {
        output.format = format;
    }
    return output;
}
