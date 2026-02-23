import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
    "img",
    "figure",
    "figcaption",
    "iframe",
    "section",
    "details",
    "summary",
    "del",
    "spoiler",
    "kbd",
    "sup",
    "sub",
]);

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": [
        "class",
        "id",
        "style",
        "title",
        "aria-label",
        "aria-hidden",
        "data-*",
    ],
    th: ["align"],
    td: ["align"],
    a: [
        ...(sanitizeHtml.defaults.allowedAttributes?.a || []),
        "target",
        "rel",
        "repo",
        "data-*",
    ],
    img: [
        "src",
        "srcset",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "decoding",
        "style",
    ],
    iframe: [
        "src",
        "style",
        "title",
        "width",
        "height",
        "frameborder",
        "border",
        "framespacing",
        "allow",
        "allowfullscreen",
        "scrolling",
        "sandbox",
    ],
};

const DEFAULT_IMG_SCHEMES = ["http", "https"] as const;
const PREVIEW_IMG_SCHEMES = ["http", "https", "blob"] as const;

/**
 * 可信嵌入域名白名单——与 CSP frame-src 对齐。
 * 匹配时授予 allow-scripts allow-same-origin allow-popups，其余来源保持空 sandbox。
 */
const TRUSTED_EMBED_HOSTS: ReadonlySet<string> = new Set([
    "www.youtube.com",
    "www.youtube-nocookie.com",
    "player.bilibili.com",
    "embed.music.apple.com",
]);

/**
 * 部分嵌入来源在官方代码中携带布局样式，但 CMS 保存时可能将其剥离。
 * 此处为已知来源补全默认样式，避免嵌入器显示异常。
 */
const DEFAULT_IFRAME_STYLES: ReadonlyMap<string, string> = new Map([
    [
        "embed.music.apple.com",
        "width:100%;max-width:660px;overflow:hidden;background:transparent;",
    ],
]);

function resolveStyleForIframe(
    src: string | undefined,
    existingStyle: string | undefined,
): string | undefined {
    if (existingStyle) return existingStyle;
    if (!src) return undefined;
    try {
        const { hostname } = new URL(src);
        return DEFAULT_IFRAME_STYLES.get(hostname);
    } catch {
        return undefined;
    }
}

const TRUSTED_SANDBOX =
    "allow-scripts allow-same-origin allow-popups allow-presentation";

function resolveSandboxForIframe(src: string | undefined): string {
    if (!src) return "";
    try {
        const { hostname } = new URL(src);
        return TRUSTED_EMBED_HOSTS.has(hostname) ? TRUSTED_SANDBOX : "";
    } catch {
        return "";
    }
}

const LAYOUT_SIZE_PATTERN = /^\d+(\.\d+)?(px|em|rem|%|vw|vh)$/;
const COLOR_PATTERN =
    /^(#[0-9a-f]{3,8}|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\)|[a-z]+)$/i;

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
    // 安全策略：仅允许基础排版样式，阻断 position/z-index/top/left 等页面覆盖能力。
    "*": {
        color: [COLOR_PATTERN],
        "background-color": [COLOR_PATTERN],
        "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
        "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        "text-align": [/^(left|center|right|justify)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
    },
    iframe: {
        width: [LAYOUT_SIZE_PATTERN],
        "max-width": [LAYOUT_SIZE_PATTERN],
        height: [LAYOUT_SIZE_PATTERN],
        overflow: [/^(hidden|auto|scroll|visible)$/],
        background: [COLOR_PATTERN],
    },
};

const NON_BOOLEAN_ATTRIBUTES =
    sanitizeHtml.defaults.nonBooleanAttributes.filter(
        (attribute) => attribute !== "sandbox",
    );

export type SanitizeMarkdownOptions = {
    allowBlobImages?: boolean;
};

function resolveAllowedSchemesByTag(
    options: SanitizeMarkdownOptions,
): sanitizeHtml.IOptions["allowedSchemesByTag"] {
    return {
        // 安全策略：默认禁用 blob，仅在受控预览链路按需放开。
        img: options.allowBlobImages
            ? [...PREVIEW_IMG_SCHEMES]
            : [...DEFAULT_IMG_SCHEMES],
        iframe: ["http", "https"],
    };
}

export function sanitizeMarkdownHtml(
    html: string,
    options: SanitizeMarkdownOptions = {},
): string {
    return sanitizeHtml(String(html || ""), {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        // 允许 sandbox 以空值/布尔属性形式输出（即严格沙箱，不授予任何 allow 权限）。
        nonBooleanAttributes: NON_BOOLEAN_ATTRIBUTES,
        // 收敛 URI scheme，移除 data 以阻断 data: SVG 等绕过路径。
        allowedSchemes: ["http", "https", "mailto", "tel"],
        allowedSchemesByTag: resolveAllowedSchemesByTag(options),
        allowedStyles: ALLOWED_STYLES,
        allowProtocolRelative: false,
        transformTags: {
            a: (tagName, attribs) => {
                const output = { ...attribs };
                if (output.target === "_blank") {
                    const rel = String(output.rel || "").trim();
                    output.rel = rel
                        ? `${rel} noopener noreferrer`.trim()
                        : "noopener noreferrer";
                }
                return { tagName, attribs: output };
            },
            iframe: (tagName, attribs) => {
                // 将协议相对 URL（//host/path）补全为 https://，
                // 必须在 sanitize-html 的 scheme 校验前处理，否则 src 会被剥离。
                const src =
                    typeof attribs.src === "string" &&
                    attribs.src.startsWith("//")
                        ? `https:${attribs.src}`
                        : attribs.src;
                const style = resolveStyleForIframe(src, attribs.style);
                const output = {
                    ...attribs,
                    ...(src !== attribs.src ? { src } : {}),
                    ...(style !== undefined ? { style } : {}),
                    sandbox: resolveSandboxForIframe(src),
                };
                return { tagName, attribs: output };
            },
        },
        nonTextTags: ["script", "style", "textarea", "option"],
    });
}
