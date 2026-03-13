// 右侧边栏布局管理器
// 用于确保右侧边栏始终可见

/**
 * 初始化页面布局
 * @param {string} _pageType - 页面类型
 */
function initPageLayout(_pageType) {
    showRightSidebar();
}

/**
 * 显示右侧边栏
 */
function showRightSidebar() {
    const rightSidebar = document.querySelector(".right-sidebar-container");
    if (rightSidebar) {
        // 恢复显示
        rightSidebar.style.display = "";
    }
}

// 页面加载完成后初始化
function initialize() {
    const pageType =
        document.documentElement.getAttribute("data-page-type") || "default";
    initPageLayout(pageType);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

// 导出函数供其他脚本使用
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        initPageLayout,
        showRightSidebar,
    };
}

// 同时也挂载到 window 对象，以便在浏览器环境中直接调用
if (typeof window !== "undefined") {
    window.rightSidebarLayout = {
        initPageLayout,
        showRightSidebar,
    };
}
