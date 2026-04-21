import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/application/auth/logout.service", () => ({
    logoutWithRefreshToken: vi.fn(),
}));

vi.mock("@/server/directus-auth", () => ({
    DIRECTUS_ACCESS_COOKIE_NAME: "cialli_directus_access",
    DIRECTUS_REFRESH_COOKIE_NAME: "cialli_directus_refresh",
    REMEMBER_COOKIE_NAME: "cialli_remember",
    getCookieOptions: vi.fn(() => ({ path: "/" })),
}));

vi.mock("@/server/security/csrf", () => ({
    assertCsrfToken: vi.fn(),
}));

import { POST } from "@/pages/api/auth/logout";
import { logoutWithRefreshToken } from "@/server/application/auth/logout.service";
import { assertCsrfToken } from "@/server/security/csrf";

const mockedLogoutWithRefreshToken = vi.mocked(logoutWithRefreshToken);
const mockedAssertCsrfToken = vi.mocked(assertCsrfToken);

function makeContext(options?: {
    url?: string;
    headers?: Record<string, string>;
}): APIContext {
    const csrf = "csrf-token";
    return createMockAPIContext({
        method: "POST",
        url: options?.url ?? "http://localhost:4321/api/auth/logout",
        body: {},
        cookies: {
            cialli_csrf: csrf,
            cialli_directus_refresh: "refresh-token",
        },
        headers: {
            "x-csrf-token": csrf,
            ...(options?.headers ?? {}),
        },
    }) as unknown as APIContext;
}

describe("/api/auth/logout origin guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedAssertCsrfToken.mockReturnValue(null);
        mockedLogoutWithRefreshToken.mockResolvedValue(undefined);
    });

    it("allows same-origin logout", async () => {
        const response = await POST(makeContext());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ ok: true });
        expect(mockedAssertCsrfToken).toHaveBeenCalledTimes(1);
        expect(mockedLogoutWithRefreshToken).toHaveBeenCalledWith(
            "refresh-token",
        );
    });

    it("accepts forwarded localhost origin from reverse proxy", async () => {
        const response = await POST(
            makeContext({
                url: "http://web:4321/api/auth/logout",
                headers: {
                    origin: "https://localhost",
                    "x-forwarded-host": "localhost",
                    "x-forwarded-proto": "https",
                },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ ok: true });
        expect(mockedAssertCsrfToken).toHaveBeenCalledTimes(1);
        expect(mockedLogoutWithRefreshToken).toHaveBeenCalledTimes(1);
    });

    it("returns 403 for unknown origin before csrf and logout", async () => {
        const response = await POST(
            makeContext({
                url: "http://web:4321/api/auth/logout",
                headers: {
                    origin: "https://evil.example",
                    "x-forwarded-host": "localhost",
                    "x-forwarded-proto": "https",
                },
            }),
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            error: { message: "非法来源请求" },
        });
        expect(mockedAssertCsrfToken).not.toHaveBeenCalled();
        expect(mockedLogoutWithRefreshToken).not.toHaveBeenCalled();
    });

    it("returns 403 when Origin header is missing", async () => {
        const response = await POST(
            makeContext({
                headers: {
                    origin: "",
                },
            }),
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            error: { message: "缺少 Origin 头" },
        });
        expect(mockedAssertCsrfToken).not.toHaveBeenCalled();
        expect(mockedLogoutWithRefreshToken).not.toHaveBeenCalled();
    });
});
