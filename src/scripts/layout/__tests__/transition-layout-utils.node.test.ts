import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    applyBannerWaveAnimationSnapshot,
    applyVtDurationFromElapsed,
    BANNER_TO_SPEC_TRANSITION_DURATION_MS,
    BANNER_TO_SPEC_VT_DURATION_VAR,
    captureBannerWaveAnimationSnapshot,
    getBannerToSpecRemainingMs,
    primeBannerWaveAnimationSnapshot,
    resolveBannerToSpecShiftMetricsFromViewportPositions,
    resolveMainPanelShiftFromViewportPositions,
    resolveTransitionProxyPayloadFromDocument,
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
        transitionProxyLayoutKey: "sidebar-main-right-article-list",
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

describe("transition layout payload helpers", () => {
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
