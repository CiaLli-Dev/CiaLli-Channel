/**
 * /me/ 账户设置页运行逻辑。
 *
 * 从页面内联脚本抽离为模块，确保页面导航后可重新初始化，
 * 避免依赖整页刷新。
 *
 * 辅助类型、常量、DOM 工具与事件绑定逻辑详见 me-page-helpers.ts。
 */

import {
    OUTSIDE_CLICK_KEY,
    createInitialState,
    queryDom,
    resetAvatarCropState,
    updateAvatarPreview,
    updateUsernameCounter,
    updateBioCounter,
    updateUsernameDisplay,
    updateBioDisplay,
    updateDisplaynameCounter,
    updateDisplaynameDisplay,
    setUsernameEditing,
    setBioEditing,
    setDisplaynameEditing,
    bindAllInputControls,
    bindEditToggleButtons,
    bindAvatarControls,
    bindProfileForm,
    bindSocialSaveBtn,
    bindPrivacyForm,
    buildOutsideClickHandler,
    runInit,
} from "@/scripts/me-page-helpers";
import type { RuntimeWindow } from "@/scripts/me-page-helpers";

const runtimeWindow = window as RuntimeWindow;

// ---------------------------------------------------------------------------
// initMePage：首屏加载与每次 astro:after-swap 后均会调用
// ---------------------------------------------------------------------------

export function initMePage(): void {
    const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (normalizedPath !== "/me") {
        return;
    }

    const dom = queryDom();
    if (!dom) {
        return;
    }

    const state = createInitialState();

    // 初始 UI 状态
    resetAvatarCropState(dom, state);
    updateAvatarPreview(dom, state);
    updateUsernameCounter(dom);
    updateBioCounter(dom);
    updateUsernameDisplay(dom);
    updateBioDisplay(dom);
    updateDisplaynameCounter(dom);
    updateDisplaynameDisplay(dom);
    setUsernameEditing(dom, false);
    setBioEditing(dom, false);
    setDisplaynameEditing(dom, false);

    // 事件绑定
    bindAllInputControls(dom, state);
    bindEditToggleButtons(dom);
    bindAvatarControls(dom, state);
    bindProfileForm(dom, state);
    bindSocialSaveBtn(dom);
    bindPrivacyForm(dom, state);

    // 外部点击：先移除旧监听，再注册新监听
    const previousOutsideClick = runtimeWindow[OUTSIDE_CLICK_KEY];
    if (typeof previousOutsideClick === "function") {
        document.removeEventListener("click", previousOutsideClick);
    }
    const handleOutsideClick = buildOutsideClickHandler(dom);
    document.addEventListener("click", handleOutsideClick);
    runtimeWindow[OUTSIDE_CLICK_KEY] = handleOutsideClick;

    // 启动鉴权与数据初始化流程
    runInit(dom, state).catch((err: unknown) => {
        console.error("[me-page] init failed", err);
    });
}

// 初始化由全局 layout 运行时通过动态导入触发，而非模块级自动执行。
// 这样可避免在切页时重复执行页面脚本。
