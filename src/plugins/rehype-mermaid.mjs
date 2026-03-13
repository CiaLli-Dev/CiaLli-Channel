import { h } from "hastscript";
import { visit } from "unist-util-visit";

function hasClass(className, classNameToMatch) {
    if (Array.isArray(className)) {
        return className.includes(classNameToMatch);
    }
    if (typeof className === "string") {
        return className.split(/\s+/).includes(classNameToMatch);
    }
    return false;
}

function getMermaidCode(properties) {
    const fromKebab = properties?.["data-mermaid-code"];
    if (typeof fromKebab === "string") {
        return fromKebab;
    }

    const fromCamel = properties?.dataMermaidCode;
    if (typeof fromCamel === "string") {
        return fromCamel;
    }

    return "";
}

export function rehypeMermaid() {
    return (tree) => {
        visit(tree, "element", (node) => {
            if (node.tagName !== "div" || !node.properties) {
                return;
            }

            if (!hasClass(node.properties.className, "mermaid-container")) {
                return;
            }

            const mermaidCode = getMermaidCode(node.properties);

            // 仅输出 Mermaid 容器，由全局 runtime 统一渲染。
            node.tagName = "div";
            node.properties = { className: ["mermaid-diagram-container"] };
            node.children = [
                h("div", { className: ["mermaid-wrapper"] }, [
                    h(
                        "div",
                        {
                            className: ["mermaid"],
                            "data-mermaid-code": mermaidCode,
                        },
                        mermaidCode,
                    ),
                ]),
            ];
        });
    };
}
