import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    applyTransitionProxySkeleton,
    BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
    BANNER_TO_SPEC_PROXY_MODE_ATTR,
    BANNER_TO_SPEC_PROXY_REVEALING_CLASS,
    BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
    bridgeCurrentBannerToIncomingDocument,
    clearTransitionProxyVisualState,
    mountTransitionProxy,
    primeBannerLayoutStateForIncomingDocument,
    settleTransitionProxyEnter,
    shouldStartBannerToSpecTransition,
    startTransitionProxyEnter,
    startTransitionProxyReveal,
    TRANSITION_PROXY_LAYOUT_ATTR,
} from "../transition-layout-utils";

function createIncomingDocument(): Document {
    return document.implementation.createHTMLDocument("incoming");
}

describe("transition layout DOM helpers", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("primeBannerLayoutStateForIncomingDocument 会把 incoming body 伪装成首页起始布局态，并恢复 banner 可见性", () => {
        const incomingDocument = createIncomingDocument();
        const bannerWrapper = incomingDocument.createElement("div");
        bannerWrapper.id = "banner-wrapper";
        bannerWrapper.classList.add("wallpaper-layer-hidden");
        bannerWrapper.setAttribute("aria-hidden", "true");
        bannerWrapper.setAttribute("inert", "");
        incomingDocument.body.dataset.layoutMode = "none";
        incomingDocument.body.dataset.routeHome = "false";
        incomingDocument.body.appendChild(bannerWrapper);

        primeBannerLayoutStateForIncomingDocument(incomingDocument);

        expect(incomingDocument.body.dataset.layoutMode).toBe("banner");
        expect(incomingDocument.body.dataset.routeHome).toBe("true");
        expect(incomingDocument.body.classList.contains("enable-banner")).toBe(
            true,
        );
        expect(incomingDocument.body.classList.contains("no-banner-mode")).toBe(
            false,
        );
        expect(incomingDocument.body.classList.contains("waves-paused")).toBe(
            false,
        );
        expect(bannerWrapper.classList.contains("wallpaper-layer-hidden")).toBe(
            false,
        );
        expect(bannerWrapper.hasAttribute("aria-hidden")).toBe(false);
        expect(bannerWrapper.hasAttribute("inert")).toBe(false);
    });

    it("bridgeCurrentBannerToIncomingDocument 会在 swap 前把当前 banner 克隆进 incoming 文档", () => {
        const currentDocument =
            document.implementation.createHTMLDocument("current");
        const incomingDocument = createIncomingDocument();
        const currentBanner = currentDocument.createElement("div");
        currentBanner.id = "banner-wrapper";
        currentBanner.dataset.bannerOrigin = "current";
        currentDocument.body.appendChild(currentBanner);
        const incomingBanner = incomingDocument.createElement("div");
        incomingBanner.id = "banner-wrapper";
        incomingDocument.body.appendChild(incomingBanner);

        const didBridge = bridgeCurrentBannerToIncomingDocument(
            incomingDocument,
            currentDocument,
        );

        expect(didBridge).toBe(true);
        expect(
            incomingDocument.getElementById("banner-wrapper")?.dataset
                .bannerOrigin,
        ).toBe("current");
    });

    it("shouldStartBannerToSpecTransition 仅在首页真实仍处于 banner 布局态时启用宏观过渡", () => {
        const body = document.body;
        body.dataset.layoutMode = "banner";
        const bannerWrapper = document.createElement("div");

        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(true);

        body.dataset.layoutMode = "collapsed";
        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(false);

        body.dataset.layoutMode = "banner";
        bannerWrapper.classList.add("wallpaper-layer-hidden");
        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(false);
    });

    it("applyTransitionProxySkeleton 会把完整代理壳与共享内容模板一并克隆进宿主", () => {
        const targetDocument = createIncomingDocument();
        const proxyHost = targetDocument.createElement("div");
        proxyHost.id = "main-panel-transition-proxy";
        proxyHost.setAttribute("hidden", "");
        targetDocument.body.appendChild(proxyHost);
        const mainPanelWrapper = targetDocument.createElement("div");
        mainPanelWrapper.className = "main-panel-wrapper";
        targetDocument.body.appendChild(mainPanelWrapper);

        const shellTemplate = targetDocument.createElement("template");
        shellTemplate.setAttribute(
            "data-transition-proxy-shell",
            "sidebar-main-right-default",
        );
        const shell = targetDocument.createElement("div");
        const mainSlot = targetDocument.createElement("div");
        mainSlot.setAttribute("data-transition-proxy-main-slot", "");
        shell.appendChild(mainSlot);
        shellTemplate.content.appendChild(shell);
        targetDocument.body.appendChild(shellTemplate);

        const contentTemplate = targetDocument.createElement("template");
        contentTemplate.setAttribute(
            "data-transition-proxy-template",
            "post-detail",
        );
        const content = targetDocument.createElement("article");
        content.dataset.content = "proxy";
        contentTemplate.content.appendChild(content);
        targetDocument.body.appendChild(contentTemplate);

        Object.defineProperty(window, "innerHeight", {
            configurable: true,
            value: 720,
        });
        Object.defineProperty(window, "scrollY", {
            configurable: true,
            value: 640,
        });

        const didApply = applyTransitionProxySkeleton(
            {
                mode: "post-detail",
                layoutKey: "sidebar-main-right-default",
            },
            targetDocument,
        );

        expect(didApply).toBe(true);
        const appendedMainSlot = proxyHost.querySelector(
            "[data-transition-proxy-main-slot]",
        );
        expect(
            appendedMainSlot?.firstElementChild?.getAttribute("data-content"),
        ).toBe("proxy");
        expect(
            targetDocument.documentElement.getAttribute(
                BANNER_TO_SPEC_PROXY_MODE_ATTR,
            ),
        ).toBe("post-detail");
        expect(
            targetDocument.documentElement.getAttribute(
                TRANSITION_PROXY_LAYOUT_ATTR,
            ),
        ).toBe("sidebar-main-right-default");
        expect(proxyHost.style.minHeight).toBe("1360px");
        expect(mainPanelWrapper.style.minHeight).toBe("1360px");
    });

    it("代理骨架显隐 helper 会按 mount -> enter -> reveal -> clear 四阶段切换状态", () => {
        const targetDocument = createIncomingDocument();
        const proxyHost = targetDocument.createElement("div");
        proxyHost.id = "main-panel-transition-proxy";
        proxyHost.setAttribute("hidden", "");
        targetDocument.body.appendChild(proxyHost);

        mountTransitionProxy(targetDocument);
        expect(proxyHost.hasAttribute("hidden")).toBe(false);

        startTransitionProxyEnter(targetDocument);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
            ),
        ).toBe(true);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
            ),
        ).toBe(true);

        settleTransitionProxyEnter(targetDocument);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
            ),
        ).toBe(false);

        startTransitionProxyReveal(targetDocument);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_REVEALING_CLASS,
            ),
        ).toBe(true);

        clearTransitionProxyVisualState(targetDocument);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
            ),
        ).toBe(false);
        expect(
            targetDocument.documentElement.classList.contains(
                BANNER_TO_SPEC_PROXY_REVEALING_CLASS,
            ),
        ).toBe(false);
        expect(proxyHost.getAttribute("hidden")).toBe("");
    });
});
