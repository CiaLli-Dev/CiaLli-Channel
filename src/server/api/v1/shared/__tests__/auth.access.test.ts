import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import { createMemberAccess } from "@/__tests__/helpers/mock-access";

vi.mock("@/server/auth/session", () => ({
    getSessionAccessToken: vi.fn(() => "test-access-token"),
    getSessionUser: vi.fn(),
}));

vi.mock("@/server/auth/acl", () => ({
    getAppAccessContext: vi.fn(),
}));

import { getSessionUser } from "@/server/auth/session";
import { getAppAccessContext } from "@/server/auth/acl";
import { requireAccess } from "@/server/api/v1/shared/auth";

const mockedGetSessionUser = vi.mocked(getSessionUser);
const mockedGetAppAccessContext = vi.mocked(getAppAccessContext);

function makeContext(): APIContext {
    return createMockAPIContext({
        method: "GET",
        url: "http://localhost:4321/api/v1/me/profile",
    }) as unknown as APIContext;
}

describe("requireAccess", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 401 when not logged in", async () => {
        mockedGetSessionUser.mockResolvedValue(null);

        const result = await requireAccess(makeContext());

        expect("response" in result).toBe(true);
        if ("response" in result) {
            expect(result.response.status).toBe(401);
        }
    });

    it("returns access when session and context are valid", async () => {
        const access = createMemberAccess();
        mockedGetSessionUser.mockResolvedValue(access.user);
        mockedGetAppAccessContext.mockResolvedValue(access);

        const result = await requireAccess(makeContext());

        expect("access" in result).toBe(true);
        if ("access" in result) {
            expect(result.access.user.id).toBe(access.user.id);
        }
    });

    it("returns generic 403 when access context lookup fails", async () => {
        mockedGetSessionUser.mockResolvedValue(createMemberAccess().user);
        mockedGetAppAccessContext.mockRejectedValue(new Error("lookup failed"));

        const result = await requireAccess(makeContext());

        expect("response" in result).toBe(true);
        if ("response" in result) {
            expect(result.response.status).toBe(403);
            const body = (await result.response.json()) as {
                ok: boolean;
                error: { message: string };
            };
            expect(body.ok).toBe(false);
            expect(body.error.message).toBe("权限不足");
        }
    });
});
