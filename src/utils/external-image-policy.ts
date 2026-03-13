export type ExternalImageRequestAttributes = {
    referrerPolicy?: "no-referrer";
    crossOrigin?: "anonymous";
};

export type ExternalImageDataAttributes = {
    "data-referrer-policy"?: "no-referrer";
    "data-cross-origin"?: "anonymous";
};

type AttributeReader = {
    getAttribute: (name: string) => string | null;
};

const ABSOLUTE_HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const ANONYMOUS_CROSS_ORIGIN_HOST_SUFFIXES = ["hdslb.com"] as const;

function parseHttpUrl(input: string): URL | null {
    const normalized = String(input || "").trim();
    if (!normalized) {
        return null;
    }

    try {
        const url = new URL(normalized);
        if (!ABSOLUTE_HTTP_PROTOCOLS.has(url.protocol)) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
}

function hasHostnameSuffix(
    hostname: string,
    suffixes: readonly string[],
): boolean {
    const normalizedHostname = String(hostname || "")
        .trim()
        .toLowerCase();
    if (!normalizedHostname) {
        return false;
    }

    return suffixes.some((suffix) => {
        const normalizedSuffix = String(suffix || "")
            .trim()
            .toLowerCase();
        if (!normalizedSuffix) {
            return false;
        }
        return (
            normalizedHostname === normalizedSuffix ||
            normalizedHostname.endsWith(`.${normalizedSuffix}`)
        );
    });
}

/**
 * Markdown 渲染链缺少稳定的站点 origin，因此这里将绝对 http/https 图片统一视为外链，
 * 统一补 no-referrer，优先解决第三方图床的防盗链 403 问题。
 */
export function resolveExternalImageRequestAttributes(
    src: string,
): ExternalImageRequestAttributes {
    const url = parseHttpUrl(src);
    if (!url) {
        return {};
    }

    return normalizeExternalImageRequestAttributes({
        referrerPolicy: "no-referrer",
        crossOrigin: hasHostnameSuffix(
            url.hostname,
            ANONYMOUS_CROSS_ORIGIN_HOST_SUFFIXES,
        )
            ? "anonymous"
            : undefined,
    });
}

export function normalizeExternalImageRequestAttributes(input: {
    referrerPolicy?: string | null | undefined;
    crossOrigin?: string | null | undefined;
}): ExternalImageRequestAttributes {
    const referrerPolicy =
        String(input.referrerPolicy || "")
            .trim()
            .toLowerCase() === "no-referrer"
            ? "no-referrer"
            : undefined;
    const crossOrigin =
        String(input.crossOrigin || "")
            .trim()
            .toLowerCase() === "anonymous"
            ? "anonymous"
            : undefined;

    return {
        ...(referrerPolicy ? { referrerPolicy } : {}),
        ...(crossOrigin ? { crossOrigin } : {}),
    };
}

export function toExternalImageDataAttributes(
    attributes: ExternalImageRequestAttributes,
): ExternalImageDataAttributes {
    return {
        ...(attributes.referrerPolicy
            ? { "data-referrer-policy": attributes.referrerPolicy }
            : {}),
        ...(attributes.crossOrigin
            ? { "data-cross-origin": attributes.crossOrigin }
            : {}),
    };
}

export function readExternalImageRequestAttributesFromElement(
    element: AttributeReader | null | undefined,
): ExternalImageRequestAttributes {
    if (!element) {
        return {};
    }

    return normalizeExternalImageRequestAttributes({
        referrerPolicy:
            element.getAttribute("data-referrer-policy") ||
            element.getAttribute("referrerpolicy"),
        crossOrigin:
            element.getAttribute("data-cross-origin") ||
            element.getAttribute("crossorigin"),
    });
}
