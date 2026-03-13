type PanelOutsideConfig = {
    panelId: string;
    ignores: string[];
};

type PanelManager = {
    closePanel: (panelId: string) => Promise<void>;
};

export const setupPanelOutsideHandler = (panelManager: PanelManager): void => {
    // 统一管理需要点击外部关闭的面板与忽略元素
    const panelOutsideConfigs: PanelOutsideConfig[] = [
        {
            panelId: "display-setting",
            ignores: ["display-setting", "scheme-switch"],
        },
    ];

    // 防止重复绑定全局点击监听
    const outsideHandlerInitialized =
        document.documentElement.dataset.panelOutsideHandlerInitialized ===
        "true";

    if (outsideHandlerInitialized) {
        return;
    }

    document.documentElement.dataset.panelOutsideHandlerInitialized = "true";
    // 单一全局监听，按配置分发关闭逻辑
    document.addEventListener("click", async (event) => {
        const tDom = event.target;
        if (!(tDom instanceof Node)) {
            return;
        }
        await Promise.all(
            panelOutsideConfigs.map(async ({ panelId, ignores }) => {
                // 命中忽略元素时，不触发关闭
                const isIgnored = ignores.some((ignoreId) => {
                    const ignoreEl = document.getElementById(ignoreId);
                    return ignoreEl !== null && ignoreEl.contains(tDom);
                });
                if (!isIgnored) {
                    await panelManager.closePanel(panelId);
                }
            }),
        );
    });
};
