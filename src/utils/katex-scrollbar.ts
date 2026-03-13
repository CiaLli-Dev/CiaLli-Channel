export const initKatexScrollbars = (): void => {
    // 完全禁用 OverlayScrollbars 的 body 初始化，避免导致页面重新加载
    // 只处理 katex 元素的滚动条
    const katexElements = document.querySelectorAll(
        ".katex-display:not([data-scrollbar-initialized])",
    ) as NodeListOf<HTMLElement>;

    katexElements.forEach((element) => {
        // 元素缺失父节点时直接跳过
        if (!element.parentNode) {
            return;
        }

        const container = document.createElement("div");
        container.className = "katex-display-container";
        element.parentNode.insertBefore(container, element);
        container.appendChild(element);

        // 使用简单的 CSS 滚动条而不是 OverlayScrollbars
        container.style.cssText = `
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(0,0,0,0.3) transparent;
        `;

        // 为 webkit 浏览器添加自定义滚动条样式
        const style = document.createElement("style");
        style.textContent = `
            .katex-display-container::-webkit-scrollbar {
                height: 6px;
            }
            .katex-display-container::-webkit-scrollbar-track {
                background: transparent;
            }
            .katex-display-container::-webkit-scrollbar-thumb {
                background: rgba(0,0,0,0.3);
                border-radius: 3px;
            }
            .katex-display-container::-webkit-scrollbar-thumb:hover {
                background: rgba(0,0,0,0.5);
            }
        `;

        // 样式只注入一次，避免重复节点
        if (!document.head.querySelector("style[data-katex-scrollbar]")) {
            style.setAttribute("data-katex-scrollbar", "true");
            document.head.appendChild(style);
        }

        element.setAttribute("data-scrollbar-initialized", "true");
    });
};
