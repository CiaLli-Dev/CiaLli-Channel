import { visit } from "unist-util-visit";

const WIDTH_TOKEN_REGEX = /(^|\s)w-([0-9]+)%(?=\s|$)/gi;
const CENTER_TOKEN_REGEX = /(^|\s)\{center\}(?=\s|$)/gi;

function isWhitespaceTextNode(node) {
    return (
        node &&
        node.type === "text" &&
        String(node.value || "").trim().length === 0
    );
}

function getSingleMeaningfulNode(children) {
    if (!Array.isArray(children) || children.length === 0) {
        return null;
    }
    const meaningful = children.filter((child) => !isWhitespaceTextNode(child));
    if (meaningful.length !== 1) {
        return null;
    }
    return meaningful[0];
}

function resolveParagraphImageContainer(children) {
    const singleNode = getSingleMeaningfulNode(children);
    if (!singleNode || singleNode.type !== "element") {
        return null;
    }

    if (singleNode.tagName === "img") {
        return {
            containerNode: singleNode,
            imageNode: singleNode,
        };
    }

    // 兼容链接包裹图片：[![alt](img)](href)
    if (singleNode.tagName === "a") {
        const innerNode = getSingleMeaningfulNode(singleNode.children || []);
        if (
            innerNode &&
            innerNode.type === "element" &&
            innerNode.tagName === "img"
        ) {
            return {
                containerNode: singleNode,
                imageNode: innerNode,
            };
        }
    }

    return null;
}

function appendClassName(properties, className) {
    const output = { ...(properties || {}) };
    const currentClass = output.className;

    if (Array.isArray(currentClass)) {
        if (!currentClass.includes(className)) {
            currentClass.push(className);
        }
        output.className = currentClass;
        return output;
    }

    if (typeof currentClass === "string" && currentClass.trim()) {
        const classList = currentClass.trim().split(/\s+/);
        if (!classList.includes(className)) {
            classList.push(className);
        }
        output.className = classList;
        return output;
    }

    output.className = [className];
    return output;
}

function normalizeImageMetadata(imageNode) {
    const properties = imageNode.properties || {};
    imageNode.properties = properties;

    const rawAlt = String(properties.alt || "");
    let parsedWidth = null;
    let centered = false;

    const normalizedAlt = rawAlt
        .replace(WIDTH_TOKEN_REGEX, (_match, leadingSpace, width) => {
            if (parsedWidth === null) {
                parsedWidth = `${width}%`;
            }
            return leadingSpace || "";
        })
        .replace(CENTER_TOKEN_REGEX, (_match, leadingSpace) => {
            centered = true;
            return leadingSpace || "";
        })
        .replace(/\s{2,}/g, " ")
        .trim();

    // 支持 alt 中的 `w-60%` 宽度语法，并将其从说明文本中剥离。
    if (parsedWidth !== null) {
        properties.width = parsedWidth;
    }
    properties.alt = normalizedAlt;

    return {
        captionText: normalizedAlt,
        centered,
    };
}

function createCaptionNode(text) {
    return {
        type: "element",
        tagName: "figcaption",
        properties: {
            className: ["md-image-caption"],
        },
        children: [
            {
                type: "text",
                value: text,
            },
        ],
    };
}

export function rehypeImageWidth() {
    return (tree) => {
        visit(tree, "element", (node) => {
            if (node.tagName !== "p") {
                return;
            }

            const matched = resolveParagraphImageContainer(node.children);
            if (!matched) {
                return;
            }

            const { containerNode, imageNode } = matched;
            const { captionText, centered } = normalizeImageMetadata(imageNode);
            const nextChildren = [containerNode];

            // 仅当 `![text](url)` 的 text 非空时才渲染图注。
            if (captionText) {
                nextChildren.push(createCaptionNode(captionText));
            }

            node.tagName = "figure";
            node.properties = appendClassName(
                node.properties,
                "md-image-figure",
            );
            // 使用显式 modifier 控制布局，默认不声明时继续保持左对齐。
            if (centered) {
                node.properties = appendClassName(
                    node.properties,
                    "md-image-figure--center",
                );
            }
            node.children = nextChildren;
        });
    };
}
