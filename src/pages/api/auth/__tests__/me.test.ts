import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/application/auth/session.service", () => ({
    getAuthenticatedViewer: vi.fn(),
}));

import { GET } from "@/pages/api/auth/me";
import { getAuthenticatedViewer } from "@/server/application/auth/session.service";

const mockedGetAuthenticatedViewer = vi.mocked(getAuthenticatedViewer);

function makeContext(url: string): APIContext {
    return createMockAPIContext({
        method: "GET",
        url,
    }) as unknown as APIContext;
}

describe("/api/auth/me", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps 401 semantics for regular logged-out requests", async () => {
        mockedGetAuthenticatedViewer.mockResolvedValue({
            ok: false,
            reason: "not_logged_in",
        });

        const response = await GET(
            makeContext("http://localhost:4321/api/auth/me"),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            message: "未登录",
        });
    });

    it("returns 200 for optional logged-out auth probes", async () => {
        mockedGetAuthenticatedViewer.mockResolvedValue({
            ok: false,
            reason: "not_logged_in",
        });

        const response = await GET(
            makeContext("http://localhost:4321/api/auth/me?optional=1"),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            message: "未登录",
        });
    });
});
