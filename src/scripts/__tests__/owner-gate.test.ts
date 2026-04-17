import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthState } from "@/scripts/auth/state";

const { getAuthStateMock, subscribeAuthStateMock } = vi.hoisted(() => ({
    getAuthStateMock: vi.fn(),
    subscribeAuthStateMock: vi.fn(),
}));

vi.mock("@/scripts/auth/state", () => ({
    getAuthState: getAuthStateMock,
    subscribeAuthState: subscribeAuthStateMock,
}));

type FakeElement = {
    hidden: boolean;
    dataset: {
        ownerId?: string;
    };
    setAttribute: (name: string, value: string) => void;
    removeAttribute: (name: string) => void;
    getAttribute: (name: string) => string | null;
};

function createFakeElement(ownerId: string): FakeElement {
    const attributes = new Map<string, string>();
    return {
        hidden: false,
        dataset: {
            ownerId,
        },
        setAttribute: (name, value) => {
            attributes.set(name, value);
        },
        removeAttribute: (name) => {
            attributes.delete(name);
        },
        getAttribute: (name) => attributes.get(name) ?? null,
    };
}

type FakeDocument = {
    querySelectorAll: <T extends Element = HTMLElement>(
        selector: string,
    ) => T[];
    addEventListener: (type: string, listener: () => void) => void;
    dispatch: (type: string) => void;
};

function createFakeDocument(elements: FakeElement[]): FakeDocument {
    const listeners = new Map<string, Array<() => void>>();

    return {
        querySelectorAll: (selector) => {
            if (selector !== "[data-owner-only][data-owner-id]") {
                return [];
            }
            return elements as never[];
        },
        addEventListener: (type, listener) => {
            const current = listeners.get(type) || [];
            current.push(listener);
            listeners.set(type, current);
        },
        dispatch: (type) => {
            const current = listeners.get(type) || [];
            current.forEach((listener) => listener());
        },
    };
}

function loggedOutState(): AuthState {
    return {
        userId: "",
        username: "",
        isAdmin: false,
        isLoggedIn: false,
    };
}

describe("owner-gate", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("initOwnerGates 仅为 owner 显示控件", async () => {
        const ownerOnly = createFakeElement("user-1");
        const outsiderOnly = createFakeElement("user-2");
        const fakeDocument = createFakeDocument([ownerOnly, outsiderOnly]);

        getAuthStateMock.mockReturnValue({
            userId: "user-1",
            username: "alice",
            isAdmin: false,
            isLoggedIn: true,
        } satisfies AuthState);

        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal("window", {} as Window);

        const { initOwnerGates } = await import("@/scripts/auth/owner-gate");

        initOwnerGates();

        expect(ownerOnly.hidden).toBe(false);
        expect(ownerOnly.getAttribute("aria-hidden")).toBeNull();
        expect(outsiderOnly.hidden).toBe(true);
        expect(outsiderOnly.getAttribute("aria-hidden")).toBe("true");
    });

    it("bindOwnerGateSync 收到鉴权变化后会重新同步，并且只订阅一次", async () => {
        const ownerOnly = createFakeElement("user-1");
        const fakeDocument = createFakeDocument([ownerOnly]);
        let authSubscriber: ((state: AuthState) => void) | null = null;

        getAuthStateMock.mockReturnValue(loggedOutState());
        subscribeAuthStateMock.mockImplementation((listener) => {
            authSubscriber = listener;
            return () => {};
        });

        vi.stubGlobal("document", fakeDocument as unknown as Document);
        vi.stubGlobal("window", {} as Window);

        const { bindOwnerGateSync } = await import("@/scripts/auth/owner-gate");

        bindOwnerGateSync();
        bindOwnerGateSync();

        expect(subscribeAuthStateMock).toHaveBeenCalledTimes(1);
        expect(ownerOnly.hidden).toBe(true);

        const applyAuth = authSubscriber as ((state: AuthState) => void) | null;
        if (applyAuth) {
            applyAuth({
                userId: "user-1",
                username: "alice",
                isAdmin: false,
                isLoggedIn: true,
            });
        }
        expect(ownerOnly.hidden).toBe(false);

        getAuthStateMock.mockReturnValue(loggedOutState());
        fakeDocument.dispatch("astro:after-swap");
        expect(ownerOnly.hidden).toBe(true);
    });
});
