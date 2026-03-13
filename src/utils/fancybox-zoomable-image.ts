import {
    normalizeExternalImageRequestAttributes,
    readExternalImageRequestAttributesFromElement,
} from "@/utils/external-image-policy";

type FancyboxZoomableSlideLike = {
    src?: unknown;
    srcset?: unknown;
    sizes?: unknown;
    alt?: unknown;
    index?: unknown;
    thumbEl?: {
        getAttribute: (name: string) => string | null;
    } | null;
    referrerPolicy?: unknown;
    crossOrigin?: unknown;
};

function toOptionalString(value: unknown): string | undefined {
    const normalized = String(value || "").trim();
    return normalized || undefined;
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function resolveFancyboxSlideImageRequestAttributes(
    slide: FancyboxZoomableSlideLike,
): ReturnType<typeof normalizeExternalImageRequestAttributes> {
    const directAttributes = normalizeExternalImageRequestAttributes({
        referrerPolicy: toOptionalString(slide.referrerPolicy),
        crossOrigin: toOptionalString(slide.crossOrigin),
    });
    const thumbAttributes = readExternalImageRequestAttributesFromElement(
        slide.thumbEl ?? null,
    );

    return {
        referrerPolicy:
            directAttributes.referrerPolicy ?? thumbAttributes.referrerPolicy,
        crossOrigin:
            directAttributes.crossOrigin ?? thumbAttributes.crossOrigin,
    };
}

/**
 * Fancybox 会重新创建放大层图片节点，这里显式继承原图的 referrer/cors 属性，
 * 避免放大查看时重新触发第三方图床防盗链。
 */
export function buildFancyboxZoomableImageTpl(
    slide: FancyboxZoomableSlideLike,
): string {
    const src = escapeHtmlAttribute(toOptionalString(slide.src) || "");
    const srcset = toOptionalString(slide.srcset);
    const sizes = toOptionalString(slide.sizes);
    const alt = escapeHtmlAttribute(toOptionalString(slide.alt) || "");
    const imageAttributes = resolveFancyboxSlideImageRequestAttributes(slide);

    return [
        '<img class="f-panzoom__content"',
        srcset ? ` data-lazy-srcset="${escapeHtmlAttribute(srcset)}"` : "",
        sizes ? ` data-lazy-sizes="${escapeHtmlAttribute(sizes)}"` : "",
        ` data-lazy-src="${src}"`,
        ` alt="${alt}"`,
        imageAttributes.referrerPolicy
            ? ` referrerpolicy="${imageAttributes.referrerPolicy}"`
            : "",
        imageAttributes.crossOrigin
            ? ` crossorigin="${imageAttributes.crossOrigin}"`
            : "",
        " />",
    ].join("");
}
