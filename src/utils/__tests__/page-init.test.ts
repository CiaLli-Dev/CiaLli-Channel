import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupPageInit } from "../page-init";

type AttributeStore = Map<string, string>;

class MockDocumentElement {
    private readonly attributes: AttributeStore = new Map();

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }
}

class MockDocument extends EventTarget {
    readyState = "complete";
    readonly documentElement = new MockDocumentElement();
}

type MockHistory = {
    state: { index?: number } | null;
    replaceState: (
        state: { index?: number },
        unused: string,
        url?: string,
    ) => void;
};

type MockLocation = {
    pathname: string;
    search: string;
    hash: string;
};

type MockPageWindow = EventTarget & {
    __pageInitRegistry?: Set<string>;
    __pageInitLastRunByKey?: Map<string, string>;
    clearTimeout: typeof clearTimeout;
    location: MockLocation;
    setTimeout: typeof setTimeout;
};

function createWindowStub(location: MockLocation): MockPageWindow {
    const windowTarget = new EventTarget() as MockPageWindow;
    windowTarget.location = location;
    windowTarget.setTimeout = setTimeout.bind(globalThis);
    windowTarget.clearTimeout = clearTimeout.bind(globalThis);
    return windowTarget;
}

function createHistoryStub(location: MockLocation): MockHistory {
    return {
        state: { index: 0 },
        replaceState: (state, _unused, url) => {
            historyStub.state = state;
            if (typeof url === "string") {
                const next = new URL(url, "https://cialli.example");
                location.pathname = next.pathname;
                location.search = next.search;
                location.hash = next.hash;
            }
        },
    };
}

let historyStub: MockHistory;

describe("setupPageInit", () => {
    let mockDocument: MockDocument;
    let mockLocation: MockLocation;
    let mockWindow: MockPageWindow;

    beforeEach(() => {
        vi.useFakeTimers();

        mockDocument = new MockDocument();
        mockLocation = {
            pathname: "/page-init-test",
            search: "",
            hash: "",
        };
        mockWindow = createWindowStub(mockLocation);
        historyStub = createHistoryStub(mockLocation);

        vi.stubGlobal("document", mockDocument);
        vi.stubGlobal("window", mockWindow);
        vi.stubGlobal("history", historyStub);
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("默认仅在 page-load 阶段重跑，不会在 swapped 阶段立即初始化", () => {
        mockDocument.documentElement.setAttribute("data-nav-phase", "swapped");
        let callCount = 0;

        setupPageInit({
            key: "page-init-default-stage",
            init: () => {
                callCount += 1;
            },
        });

        vi.runAllTimers();
        expect(callCount).toBe(0);

        mockDocument.dispatchEvent(new Event("astro:after-swap"));
        vi.runAllTimers();
        expect(callCount).toBe(0);

        mockDocument.dispatchEvent(new Event("astro:page-load"));
        vi.runAllTimers();
        expect(callCount).toBe(1);
    });

    it("navigation-settled 阶段会等待收尾事件后再初始化", () => {
        mockDocument.documentElement.setAttribute("data-nav-phase", "swapped");
        let callCount = 0;

        setupPageInit({
            key: "page-init-navigation-settled",
            init: () => {
                callCount += 1;
            },
            stages: ["navigation-settled"],
        });

        vi.runAllTimers();
        expect(callCount).toBe(0);

        mockDocument.dispatchEvent(new Event("cialli:navigation:settled"));
        vi.runAllTimers();
        expect(callCount).toBe(1);
    });

    it("同一导航签名下不会因立即执行与 page-load 重复初始化", () => {
        let callCount = 0;

        setupPageInit({
            key: "page-init-dedupe",
            init: () => {
                callCount += 1;
            },
        });

        vi.runAllTimers();
        expect(callCount).toBe(1);

        mockDocument.dispatchEvent(new Event("astro:page-load"));
        vi.runAllTimers();
        expect(callCount).toBe(1);
    });
});
