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

function loggedOutState(): AuthState {
    return {
        userId: "",
        username: "",
        isAdmin: false,
        isLoggedIn: false,
    };
}

describe("password-protection-owner", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("基于 auth state 判断当前访问者是否为 owner", async () => {
        const { isPasswordProtectionOwner } =
            await import("@/scripts/password-protection-owner");

        expect(
            isPasswordProtectionOwner("author-1", {
                userId: "author-1",
                username: "alice",
                isAdmin: false,
                isLoggedIn: true,
            }),
        ).toBe(true);
        expect(
            isPasswordProtectionOwner("author-1", {
                userId: "viewer-1",
                username: "bob",
                isAdmin: false,
                isLoggedIn: true,
            }),
        ).toBe(false);
    });

    it("会订阅 auth state 变化并在 owner 登录后恢复 owner 辅助判断", async () => {
        let authSubscriber: ((state: AuthState) => void) | null = null;
        getAuthStateMock.mockReturnValue(loggedOutState());
        subscribeAuthStateMock.mockImplementation((listener) => {
            authSubscriber = listener;
            return () => {};
        });

        const { bindPasswordProtectionOwnerSync } =
            await import("@/scripts/password-protection-owner");
        const ownerChanges: boolean[] = [];

        bindPasswordProtectionOwnerSync("author-1", (isOwner) => {
            ownerChanges.push(isOwner);
        });

        const applyAuth = authSubscriber as ((state: AuthState) => void) | null;
        applyAuth?.({
            userId: "author-1",
            username: "alice",
            isAdmin: false,
            isLoggedIn: true,
        });

        expect(ownerChanges).toEqual([false, true]);
        expect(subscribeAuthStateMock).toHaveBeenCalledTimes(1);
    });
});
