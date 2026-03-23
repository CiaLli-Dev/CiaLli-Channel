import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    resolvePreparationRouteState,
    resolvePreparationTransitionProxyPayload,
    shouldResetViewportOnPreparation,
} from "../transition-hooks";

function createSourceDocumentWithRightSidebar(): Document {
    const rightSidebarSlot = Object.assign(new HTMLElement(), {
        classList: {
            contains: () => false,
        },
        children: [{}],
    });

    return {
        documentElement: {
            classList: {
                contains: () => false,
            },
        },
        querySelector: (_selector: string) => null,
        getElementById: (id: string) =>
            id === "right-sidebar-slot" ? rightSidebarSlot : null,
        body: {
            dataset: {
                routePostEditor: "false",
            },
        },
    } as unknown as Document;
}

function createBasicDocument(): Document {
    return {
        documentElement: {
            classList: {
                contains: () => false,
            },
        },
        querySelector: () => null,
        getElementById: () => null,
        body: {
            dataset: {
                routePostEditor: "false",
            },
        },
    } as unknown as Document;
}

function createBody(routeHome: "true" | "false"): HTMLElement {
    return Object.assign(new HTMLElement(), {
        dataset: {
            routeHome,
        },
        classList: {
            contains: (token: string) =>
                token === "lg:is-home" && routeHome === "true",
        },
    });
}

const routeDeps = {
    pathsEqual: (left: string, right: string) => left === right,
    url: (path: string) => path,
};

describe("transition-hooks", () => {
    beforeEach(() => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("准备阶段会以事件的来源路径作为当前页，而不是依赖 live location", () => {
        expect(
            resolvePreparationRouteState(
                "/posts/demo",
                "/",
                createBody("false"),
                routeDeps,
            ),
        ).toEqual({
            sourcePathname: "/posts/demo",
            targetPathname: "/",
            currentIsHome: false,
            isTargetHome: true,
        });
    });

    it("首页离开时即使 body 状态短暂不同步，也仍会按来源路径命中首页分支", () => {
        expect(
            resolvePreparationRouteState(
                "/",
                "/posts",
                createBody("false"),
                routeDeps,
            ),
        ).toEqual({
            sourcePathname: "/",
            targetPathname: "/posts",
            currentIsHome: true,
            isTargetHome: false,
        });
    });

    it("文章详情返回首页时会沿用来源页的骨架壳，而不是首页 fallback", () => {
        expect(
            resolvePreparationTransitionProxyPayload(
                "/posts/demo",
                "/",
                createSourceDocumentWithRightSidebar(),
                true,
                false,
            ),
        ).toEqual({
            payload: {
                mode: "post-detail",
                layoutKey: "sidebar-main-right-default",
            },
            preservePreparedPayload: true,
        });
    });

    it("首页 banner -> spec 仍跳过即时 proxy，继续沿用既有整页上推动画", () => {
        expect(
            resolvePreparationTransitionProxyPayload(
                "/",
                "/posts",
                createBasicDocument(),
                false,
                true,
            ),
        ).toEqual({
            payload: null,
            preservePreparedPayload: false,
        });
    });

    it("首页 banner -> spec 准备阶段不会先触发回顶", () => {
        expect(shouldResetViewportOnPreparation(true)).toBe(false);
    });

    it("非 banner -> spec 导航准备阶段仍会保持既有回顶策略", () => {
        expect(shouldResetViewportOnPreparation(false)).toBe(true);
    });

    it("普通 spec -> spec 导航继续返回既有 proxy payload", () => {
        expect(
            resolvePreparationTransitionProxyPayload(
                "/about",
                "/posts",
                createBasicDocument(),
                false,
                false,
            ),
        ).toEqual({
            payload: {
                mode: "post-card",
                layoutKey: "sidebar-main-right-archive",
            },
            preservePreparedPayload: false,
        });
    });
});
