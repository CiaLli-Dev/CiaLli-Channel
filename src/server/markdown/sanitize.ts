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
        "title",
        "width",
        "height",
        "frameborder",
        "allow",
        "allowfullscreen",
        "scrolling",
        "sandbox",
    ],
};

const DEFAULT_IMG_SCHEMES = ["http", "https"] as const;
const PREVIEW_IMG_SCHEMES = ["http", "https", "blob"] as const;

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
    // 安全策略：仅允许基础排版样式，阻断 position/z-index/top/left 等页面覆盖能力。
    "*": {
        color: [/^(#[0-9a-f]{3,8}|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\)|[a-z]+)$/i],
        "background-color": [
            /^(#[0-9a-f]{3,8}|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\)|[a-z]+)$/i,
        ],
        "font-size": [/^\d+(\.\d+)?(px|em|rem|%)$/],
        "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        "text-align": [/^(left|center|right|justify)$/],
        "text-decoration": [/^(none|underline|line-through)$/],
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
                // 强制空 sandbox：严格隔离 iframe，避免脚本与同源能力被放行。
                const output = { ...attribs, sandbox: "" };
                return { tagName, attribs: output };
            },
        },
        nonTextTags: ["script", "style", "textarea", "option"],
    });
}
