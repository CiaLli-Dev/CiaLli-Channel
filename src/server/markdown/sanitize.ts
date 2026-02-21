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
    ],
};

const ALLOWED_SCHEMES_BY_TAG: sanitizeHtml.IOptions["allowedSchemesByTag"] = {
    img: ["http", "https", "data", "blob"],
    iframe: ["http", "https"],
};

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

export function sanitizeMarkdownHtml(html: string): string {
    return sanitizeHtml(String(html || ""), {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedSchemes: ["http", "https", "mailto", "tel", "data"],
        allowedSchemesByTag: ALLOWED_SCHEMES_BY_TAG,
        allowedStyles: ALLOWED_STYLES,
        allowProtocolRelative: true,
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
        },
        nonTextTags: ["script", "style", "textarea", "option"],
    });
}
