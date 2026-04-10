type TocRuntimeElement = HTMLElement & {
    init?: () => void;
    regenerateTOC?: () => void;
};

export function getTocRuntimeElements(
    root: ParentNode = document,
): TocRuntimeElement[] {
    return Array.from(
        root.querySelectorAll<TocRuntimeElement>("table-of-contents"),
    );
}

export function reinitAllTocInstances(root: ParentNode = document): void {
    const tocElements = getTocRuntimeElements(root);
    if (tocElements.length === 0) {
        return;
    }

    // 先统一重建目录内容，再统一重新绑定滚动/激活态，避免多实例只更新第一份。
    tocElements.forEach((tocElement) => {
        tocElement.regenerateTOC?.();
    });
    tocElements.forEach((tocElement) => {
        tocElement.init?.();
    });
}
