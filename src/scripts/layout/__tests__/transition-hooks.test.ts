import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    resolvePreparationRouteState,
    resolvePreparationTransitionProxyPayload,
    scheduleAbortedPreparationReset,
    schedulePreventedPreparationReset,
    shouldResetViewportOnPreparation,
    wrapPreparationLoaderWithReset,
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
            contains: () => false,
        },
    });
}

const routeDeps = {
    pathsEqual: (left: string, right: string) => left === right,
    url: (path: string) => path,
};

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        queueMicrotask(resolve);
    });
}

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
                layoutKey: "sidebar-main-right-article-list",
            },
            preservePreparedPayload: false,
        });
    });

    it("准备阶段 loader 失败时会触发复位并继续抛出原错误", async () => {
        const reset = vi.fn();
        const loaderError = new Error("blocked by response");
        const originalLoader = vi.fn().mockRejectedValue(loaderError);
        const event = {
            defaultPrevented: false,
            loader: originalLoader,
        };

        wrapPreparationLoaderWithReset(event, reset);

        await expect(event.loader()).rejects.toThrow(loaderError);
        expect(reset).toHaveBeenCalledTimes(1);
        expect(originalLoader).toHaveBeenCalledTimes(1);
    });

    it("准备阶段已 preventDefault 时 loader 不再执行并触发复位", async () => {
        const reset = vi.fn();
        const originalLoader = vi.fn().mockResolvedValue(undefined);
        const event = {
            defaultPrevented: true,
            loader: originalLoader,
        };

        wrapPreparationLoaderWithReset(event, reset);
        await event.loader();

        expect(reset).toHaveBeenCalledTimes(1);
        expect(originalLoader).not.toHaveBeenCalled();
    });

    it("准备阶段被后续监听器 preventDefault 时会在微任务中复位", async () => {
        const reset = vi.fn();
        const shouldReset = vi.fn().mockReturnValue(true);
        const event = {
            defaultPrevented: false,
        };

        schedulePreventedPreparationReset(event, shouldReset, reset);
        event.defaultPrevented = true;
        await flushMicrotasks();

        expect(shouldReset).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it("准备阶段导航被 abort 且仍是当前导航时会复位", () => {
        const reset = vi.fn();
        const shouldReset = vi.fn().mockReturnValue(true);
        const controller = new AbortController();

        scheduleAbortedPreparationReset(
            { signal: controller.signal },
            shouldReset,
            reset,
        );
        controller.abort();

        expect(shouldReset).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledTimes(1);
    });

    it("准备阶段旧导航 abort 不会误复位新导航", () => {
        const reset = vi.fn();
        const shouldReset = vi.fn().mockReturnValue(false);
        const controller = new AbortController();

        scheduleAbortedPreparationReset(
            { signal: controller.signal },
            shouldReset,
            reset,
        );
        controller.abort();

        expect(shouldReset).toHaveBeenCalledTimes(1);
        expect(reset).not.toHaveBeenCalled();
    });
});
