import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    BANNER_TO_SPEC_PROXY_ENTERING_CLASS,
    BANNER_TO_SPEC_PROXY_MODE_ATTR,
    BANNER_TO_SPEC_PROXY_REVEALING_CLASS,
    BANNER_TO_SPEC_PROXY_VISIBLE_CLASS,
    BANNER_TO_SPEC_TRANSITION_DURATION_MS,
    BANNER_TO_SPEC_VT_DURATION_VAR,
    applyTransitionProxySkeleton,
    applyBannerWaveAnimationSnapshot,
    applyVtDurationFromElapsed,
    bridgeCurrentBannerToIncomingDocument,
    captureBannerWaveAnimationSnapshot,
    clearTransitionProxyVisualState,
    getBannerToSpecRemainingMs,
    mountTransitionProxy,
    primeBannerWaveAnimationSnapshot,
    primeBannerLayoutStateForIncomingDocument,
    resolveBannerToSpecShiftMetricsFromViewportPositions,
    resolveMainPanelShiftFromViewportPositions,
    resolveTransitionProxyPayloadFromDocument,
    settleTransitionProxyEnter,
    startTransitionProxyEnter,
    startTransitionProxyReveal,
    shouldStartBannerToSpecTransition,
    TRANSITION_PROXY_LAYOUT_ATTR,
    type TransitionState,
} from "../transition-layout-utils";

type StyleStore = {
    getPropertyValue: (name: string) => string;
    setProperty: (name: string, value: string) => void;
};

function createStyleStore(): StyleStore {
    const values = new Map<string, string>();
    return {
        getPropertyValue: (name) => values.get(name) ?? "",
        setProperty: (name, value) => {
            values.set(name, value);
        },
    };
}

function createTransitionState(): TransitionState {
    return {
        pendingBannerToSpecRoutePath: "/posts",
        pendingTransitionProxyRoutePath: "/posts",
        pendingSidebarProfilePatch: null,
        pendingBannerWaveAnimationSnapshot: null,
        bannerToSpecAnimationStartedAt: 100,
        bannerToSpecMotionDurationMs: BANNER_TO_SPEC_TRANSITION_DURATION_MS,
        transitionProxyMode: "post-card",
        transitionProxyLayoutKey: "sidebar-main-right-archive",
        preservePreparedTransitionProxyPayload: false,
        bannerToSpecMotionCompleted: false,
        bannerToSpecMotionPromise: null,
        bannerToSpecMotionResolve: null,
        bannerToSpecMotionTimerId: null,
        bannerToSpecLoaderSettled: false,
        proxyEnterFrameId: null,
        proxyEnterTimerId: null,
        proxyRevealTimerId: null,
        viewTransitionFinished: null,
        delayedPageViewTimerId: null,
        didReplaceContentDuringVisit: true,
        didForceNavbarScrolledForBannerToSpec: false,
        pendingSpecToBannerFreeze: false,
        navigationInProgress: true,
        navigationToken: 1,
        lastFinalizedNavigationToken: null,
    };
}

function createClassList() {
    const values = new Set<string>();
    return {
        add: (...tokens: string[]) => {
            tokens.forEach((token) => values.add(token));
        },
        remove: (...tokens: string[]) => {
            tokens.forEach((token) => values.delete(token));
        },
        toggle: (token: string, force?: boolean) => {
            const shouldAdd =
                typeof force === "boolean" ? force : !values.has(token);
            if (shouldAdd) {
                values.add(token);
                return true;
            }
            values.delete(token);
            return false;
        },
        contains: (token: string) => values.has(token),
    };
}

type MockAnimation = {
    currentTime: number | null;
    effect?: {
        getTiming: () => {
            duration: number;
        };
    };
};

type MockAnimatedWaveUse = {
    style: {
        animationDelay: string;
        animationDuration: string;
        animationPlayState: string;
    };
    getAnimations: () => MockAnimation[];
};

function createMockAnimatedWaveUse(
    currentTime: number,
    durationMs = 7000,
): MockAnimatedWaveUse {
    const animation: MockAnimation = {
        currentTime,
        effect: {
            getTiming: () => ({
                duration: durationMs,
            }),
        },
    };
    return {
        style: {
            animationDelay: "",
            animationDuration: "",
            animationPlayState: "",
        },
        getAnimations: () => [animation],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("transition layout timing helpers", () => {
    const rootStyle = createStyleStore();

    beforeEach(() => {
        vi.stubGlobal("document", {
            documentElement: {
                style: rootStyle,
            },
        });
    });

    it("getBannerToSpecRemainingMs 会基于统一的 980ms 宏观时长计算剩余时间", () => {
        const state = createTransitionState();
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(240);

        expect(getBannerToSpecRemainingMs(state)).toBe(
            BANNER_TO_SPEC_TRANSITION_DURATION_MS - 140,
        );

        nowSpy.mockRestore();
    });

    it("applyVtDurationFromElapsed 会将剩余时长同步到当前与传入文档", () => {
        const state = createTransitionState();
        const incomingDocument = {
            documentElement: {
                style: createStyleStore(),
            },
        } as Document;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(460);

        applyVtDurationFromElapsed(state, incomingDocument);

        expect(rootStyle.getPropertyValue(BANNER_TO_SPEC_VT_DURATION_VAR)).toBe(
            "620ms",
        );
        expect(
            incomingDocument.documentElement.style.getPropertyValue(
                BANNER_TO_SPEC_VT_DURATION_VAR,
            ),
        ).toBe("620ms");

        nowSpy.mockRestore();
    });

    it("resolveMainPanelShiftFromViewportPositions 会基于当前 viewport 几何计算主内容上滑距离", () => {
        const shiftFromHigherViewportTop =
            resolveMainPanelShiftFromViewportPositions({
                mainPanelTop: 260,
                targetTop: 88,
                sidebarTops: [240, 252],
            });
        const shiftFromLowerViewportTop =
            resolveMainPanelShiftFromViewportPositions({
                mainPanelTop: 420,
                targetTop: 88,
                sidebarTops: [400, 412],
            });

        expect(shiftFromHigherViewportTop).toBeLessThan(
            shiftFromLowerViewportTop,
        );
        expect(shiftFromHigherViewportTop).toBe(152.75);
        expect(shiftFromLowerViewportTop).toBe(312.75);
    });

    it("resolveBannerToSpecShiftMetricsFromViewportPositions 会同时产出内容位移与背景封顶位移", () => {
        const metrics = resolveBannerToSpecShiftMetricsFromViewportPositions({
            mainPanelTop: 420,
            targetTop: 88,
            sidebarTops: [400, 412],
        });

        expect(metrics.mainPanelShiftPx).toBe(312.75);
        expect(metrics.backgroundOvershootPx).toBe(88);
    });
});

// eslint-disable-next-line max-lines-per-function -- 单测集中覆盖 transition DOM helper 的完整 swap 生命周期
describe("transition layout DOM helpers", () => {
    it("primeBannerLayoutStateForIncomingDocument 会把 incoming body 伪装成首页起始布局态，并恢复 banner 可见性", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const body = Object.assign(new MockHtmlElement(), {
            dataset: {
                layoutMode: "none",
                routeHome: "false",
            },
            classList: createClassList(),
        });
        const bannerWrapper = Object.assign(new MockHtmlElement(), {
            classList: createClassList(),
            removeAttribute: vi.fn(),
        });
        bannerWrapper.classList.add("wallpaper-layer-hidden");

        const incomingDocument = {
            body,
            getElementById: (id: string) =>
                id === "banner-wrapper" ? bannerWrapper : null,
        } as unknown as Document;

        primeBannerLayoutStateForIncomingDocument(incomingDocument);

        expect(body.dataset.layoutMode).toBe("banner");
        expect(body.dataset.routeHome).toBe("true");
        expect(body.classList.contains("enable-banner")).toBe(true);
        expect(body.classList.contains("no-banner-mode")).toBe(false);
        expect(body.classList.contains("waves-paused")).toBe(false);
        expect(bannerWrapper.classList.contains("wallpaper-layer-hidden")).toBe(
            false,
        );
        expect(bannerWrapper.removeAttribute).toHaveBeenCalledWith(
            "aria-hidden",
        );
        expect(bannerWrapper.removeAttribute).toHaveBeenCalledWith("inert");
    });

    it("bridgeCurrentBannerToIncomingDocument 会在 swap 前把当前 banner 克隆进 incoming 文档", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const bridgedBanner = Object.assign(new MockHtmlElement(), {
            marker: "bridged",
        });
        const currentBanner = Object.assign(new MockHtmlElement(), {
            cloneNode: vi.fn(() => bridgedBanner),
        });
        const incomingBanner = Object.assign(new MockHtmlElement(), {
            replaceWith: vi.fn(),
        });
        const currentDocument = {
            getElementById: (id: string) =>
                id === "banner-wrapper" ? currentBanner : null,
        } as unknown as Document;
        const incomingDocument = {
            getElementById: (id: string) =>
                id === "banner-wrapper" ? incomingBanner : null,
        } as unknown as Document;

        const didBridge = bridgeCurrentBannerToIncomingDocument(
            incomingDocument,
            currentDocument,
        );

        expect(didBridge).toBe(true);
        expect(currentBanner.cloneNode).toHaveBeenCalledWith(true);
        expect(incomingBanner.replaceWith).toHaveBeenCalledTimes(1);
        expect(incomingBanner.replaceWith.mock.calls[0]?.[0]).toBe(
            bridgedBanner,
        );
        expect(incomingBanner.replaceWith.mock.calls[0]?.[0]).not.toBe(
            currentBanner,
        );
    });

    it("bridgeCurrentBannerToIncomingDocument 在缺少当前或 incoming banner 时会直接跳过", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const currentDocument = {
            getElementById: () => null,
        } as unknown as Document;
        const incomingDocument = {
            getElementById: () => null,
        } as unknown as Document;

        expect(
            bridgeCurrentBannerToIncomingDocument(
                incomingDocument,
                currentDocument,
            ),
        ).toBe(false);
    });

    it("shouldStartBannerToSpecTransition 仅在首页真实仍处于 banner 布局态时启用宏观过渡", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const body = Object.assign(new MockHtmlElement(), {
            dataset: {
                layoutMode: "banner",
            },
        }) as unknown as HTMLElement;
        const bannerWrapper = Object.assign(new MockHtmlElement(), {
            classList: createClassList(),
        }) as unknown as HTMLElement;

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
        class MockHtmlElement {}
        class MockTemplateElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);
        vi.stubGlobal("HTMLTemplateElement", MockTemplateElement);
        vi.stubGlobal("window", {
            innerHeight: 720,
            scrollY: 640,
        });

        const appendedNodes: unknown[] = [];
        const mainSlot = Object.assign(new MockHtmlElement(), {
            appendChild: vi.fn(),
        });
        const shellFragment = {
            querySelector: vi.fn((selector: string) =>
                selector === "[data-transition-proxy-main-slot]"
                    ? mainSlot
                    : null,
            ),
        };
        const proxyHost = Object.assign(new MockHtmlElement(), {
            firstChild: null,
            hasAttribute: vi.fn(() => false),
            removeChild: vi.fn(),
            appendChild: vi.fn((node: unknown) => {
                appendedNodes.push(node);
                return node;
            }),
            setAttribute: vi.fn(),
            style: {
                minHeight: "",
            },
        });
        const mainPanelWrapper = Object.assign(new MockHtmlElement(), {
            hasAttribute: vi.fn(() => false),
            setAttribute: vi.fn(),
            style: {
                minHeight: "",
            },
        });
        const contentFragment = { marker: "proxy-content-fragment" };
        const shellTemplate = Object.assign(new MockTemplateElement(), {
            content: {
                cloneNode: vi.fn(() => shellFragment),
            },
        });
        const contentTemplate = Object.assign(new MockTemplateElement(), {
            content: {
                cloneNode: vi.fn(() => contentFragment),
            },
        });
        const documentElement = {
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
        };
        const targetDocument = {
            documentElement,
            getElementById: (id: string) =>
                id === "main-panel-transition-proxy" ? proxyHost : null,
            querySelector: (selector: string) =>
                selector === ".main-panel-wrapper"
                    ? mainPanelWrapper
                    : selector ===
                        '[data-transition-proxy-shell="sidebar-main-right-default"]'
                      ? shellTemplate
                      : selector ===
                          '[data-transition-proxy-template="post-detail"]'
                        ? contentTemplate
                        : null,
        } as unknown as Document;

        const didApply = applyTransitionProxySkeleton(
            {
                mode: "post-detail",
                layoutKey: "sidebar-main-right-default",
            },
            targetDocument,
        );

        expect(didApply).toBe(true);
        expect(shellTemplate.content.cloneNode).toHaveBeenCalledWith(true);
        expect(contentTemplate.content.cloneNode).toHaveBeenCalledWith(true);
        expect(mainSlot.appendChild).toHaveBeenCalledWith(contentFragment);
        expect(appendedNodes[0]).toBe(shellFragment);
        expect(documentElement.setAttribute).toHaveBeenCalledWith(
            BANNER_TO_SPEC_PROXY_MODE_ATTR,
            "post-detail",
        );
        expect(documentElement.setAttribute).toHaveBeenCalledWith(
            TRANSITION_PROXY_LAYOUT_ATTR,
            "sidebar-main-right-default",
        );
        expect(proxyHost.style.minHeight).toBe("1360px");
        expect(mainPanelWrapper.style.minHeight).toBe("1360px");
    });

    it("代理骨架显隐 helper 会按 mount -> enter -> reveal -> clear 四阶段切换状态", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const classList = createClassList();
        const proxyHost = Object.assign(new MockHtmlElement(), {
            firstChild: null,
            removeChild: vi.fn(),
            removeAttribute: vi.fn(),
            setAttribute: vi.fn(),
        });
        const targetDocument = {
            documentElement: {
                classList,
                setAttribute: vi.fn(),
                removeAttribute: vi.fn(),
            },
            getElementById: (id: string) =>
                id === "main-panel-transition-proxy" ? proxyHost : null,
            querySelectorAll: () => [],
        } as unknown as Document;

        mountTransitionProxy(targetDocument);
        expect(proxyHost.removeAttribute).toHaveBeenCalledWith("hidden");

        startTransitionProxyEnter(targetDocument);
        expect(classList.contains(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS)).toBe(
            true,
        );
        expect(classList.contains(BANNER_TO_SPEC_PROXY_ENTERING_CLASS)).toBe(
            true,
        );

        settleTransitionProxyEnter(targetDocument);
        expect(classList.contains(BANNER_TO_SPEC_PROXY_ENTERING_CLASS)).toBe(
            false,
        );

        startTransitionProxyReveal(targetDocument);
        expect(classList.contains(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS)).toBe(
            true,
        );
        expect(classList.contains(BANNER_TO_SPEC_PROXY_REVEALING_CLASS)).toBe(
            true,
        );

        clearTransitionProxyVisualState(targetDocument);
        expect(classList.contains(BANNER_TO_SPEC_PROXY_VISIBLE_CLASS)).toBe(
            false,
        );
        expect(classList.contains(BANNER_TO_SPEC_PROXY_REVEALING_CLASS)).toBe(
            false,
        );
        expect(proxyHost.setAttribute).toHaveBeenCalledWith("hidden", "");
    });

    it("resolveTransitionProxyPayloadFromDocument 会优先按真实 incoming DOM 修正右栏布局", () => {
        const targetDocument = {
            documentElement: {
                classList: {
                    contains: () => false,
                },
            },
            body: {
                dataset: {
                    routePostEditor: "false",
                },
            },
            querySelector: (selector: string) =>
                selector === ".album-filter-panel" ? {} : null,
            getElementById: (_id: string) => null,
        } as unknown as Document;

        expect(
            resolveTransitionProxyPayloadFromDocument(
                targetDocument,
                "/alice/albums",
            ),
        ).toEqual({
            mode: "user-albums",
            layoutKey: "sidebar-main-right-albums",
        });
    });

    it("resolveTransitionProxyPayloadFromDocument 会为 auth 路由保留专用代理壳", () => {
        const targetDocument = {
            documentElement: {
                classList: {
                    contains: () => false,
                },
            },
            body: {
                dataset: {
                    routePostEditor: "false",
                },
            },
            querySelector: (selector: string) =>
                selector === '[data-enter-skeleton-page="auth-login"]'
                    ? {}
                    : null,
            getElementById: (_id: string) => null,
        } as unknown as Document;

        expect(
            resolveTransitionProxyPayloadFromDocument(
                targetDocument,
                "/auth/login",
            ),
        ).toEqual({
            mode: "auth-login",
            layoutKey: "sidebar-main",
        });
    });
});

describe("banner wave animation snapshot helpers", () => {
    it("captureBannerWaveAnimationSnapshot 会记录当前首页波浪动画进度", () => {
        const sourceDocument = {
            querySelectorAll: (selector: string) =>
                selector === "#header-waves use"
                    ? [
                          createMockAnimatedWaveUse(1250, 7000),
                          createMockAnimatedWaveUse(980, 10000),
                      ]
                    : [],
        } as unknown as Document;

        expect(captureBannerWaveAnimationSnapshot(sourceDocument)).toEqual({
            layers: [
                {
                    currentTimeMs: 1250,
                    durationMs: 7000,
                },
                {
                    currentTimeMs: 980,
                    durationMs: 10000,
                },
            ],
        });
    });

    it("primeBannerWaveAnimationSnapshot 会把 incoming 文档首帧波浪相位预写进去", () => {
        const bannerWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const backgroundWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const targetDocument = {
            querySelectorAll: (selector: string) => {
                if (selector === "#header-waves use") {
                    return bannerWaveUses;
                }
                if (selector === ".main-panel-transition-bg-wave use") {
                    return backgroundWaveUses;
                }
                return [];
            },
        } as unknown as Document;

        primeBannerWaveAnimationSnapshot(
            {
                layers: [
                    {
                        currentTimeMs: 1100,
                        durationMs: 7000,
                    },
                    {
                        currentTimeMs: 760,
                        durationMs: 10000,
                    },
                ],
            },
            targetDocument,
        );

        expect(bannerWaveUses[0]?.style.animationDuration).toBe("7000ms");
        expect(bannerWaveUses[0]?.style.animationDelay).toBe("-1100ms");
        expect(bannerWaveUses[1]?.style.animationDuration).toBe("10000ms");
        expect(bannerWaveUses[1]?.style.animationDelay).toBe("-760ms");
        expect(backgroundWaveUses[0]?.style.animationDelay).toBe("-1100ms");
        expect(backgroundWaveUses[1]?.style.animationDelay).toBe("-760ms");
    });

    it("applyBannerWaveAnimationSnapshot 会把 live DOM 的波浪 currentTime 校正到旧页面相位", () => {
        const bannerWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const backgroundWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const targetDocument = {
            querySelectorAll: (selector: string) => {
                if (selector === "#header-waves use") {
                    return bannerWaveUses;
                }
                if (selector === ".main-panel-transition-bg-wave use") {
                    return backgroundWaveUses;
                }
                return [];
            },
        } as unknown as Document;

        applyBannerWaveAnimationSnapshot(
            {
                layers: [
                    {
                        currentTimeMs: 1100,
                        durationMs: 7000,
                    },
                    {
                        currentTimeMs: 760,
                        durationMs: 10000,
                    },
                ],
            },
            targetDocument,
        );

        expect(bannerWaveUses[0]?.getAnimations()[0]?.currentTime).toBe(1100);
        expect(bannerWaveUses[1]?.getAnimations()[0]?.currentTime).toBe(760);
        expect(backgroundWaveUses[0]?.getAnimations()[0]?.currentTime).toBe(
            1100,
        );
        expect(backgroundWaveUses[1]?.getAnimations()[0]?.currentTime).toBe(
            760,
        );
    });
});
