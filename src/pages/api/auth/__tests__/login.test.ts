import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/directus-auth", () => {
    class MockDirectusAuthError extends Error {
        directusStatus?: number;

        constructor(directusStatus?: number) {
            super("directus auth error");
            this.name = "DirectusAuthError";
            this.directusStatus = directusStatus;
        }
    }

    return {
        DirectusAuthError: MockDirectusAuthError,
        DIRECTUS_ACCESS_COOKIE_NAME: "cialli_directus_access",
        DIRECTUS_REFRESH_COOKIE_NAME: "cialli_directus_refresh",
        REMEMBER_COOKIE_NAME: "cialli_remember",
        directusLogin: vi.fn(),
        directusGetMe: vi.fn(),
        getCookieOptions: vi.fn(() => ({ path: "/" })),
        getRememberCookieOptions: vi.fn(() => ({ path: "/" })),
        pickPublicUserInfo: vi.fn(),
        resolveAccessTokenMaxAgeSeconds: vi.fn(() => 900),
    };
});

vi.mock("@/server/auth/registration-request-cookie", () => ({
    clearRegistrationRequestCookie: vi.fn(),
    normalizeRegistrationRequestId: vi.fn(),
    REGISTRATION_REQUEST_COOKIE_NAME: "dc_registration_request",
}));

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
}));

vi.mock("@/server/security/rate-limit", () => ({
    applyRateLimit: vi.fn(),
    rateLimitResponse: vi.fn(),
}));

vi.mock("@/server/security/csrf", () => ({
    assertCsrfToken: vi.fn(),
    rotateCsrfCookie: vi.fn(),
}));

import {
    directusGetMe,
    directusLogin,
    pickPublicUserInfo,
} from "@/server/directus-auth";
import { readMany } from "@/server/directus/client";
import {
    applyRateLimit,
    rateLimitResponse,
} from "@/server/security/rate-limit";
import { assertCsrfToken, rotateCsrfCookie } from "@/server/security/csrf";
import { POST } from "@/pages/api/auth/login";

const mockedDirectusLogin = vi.mocked(directusLogin);
const mockedDirectusGetMe = vi.mocked(directusGetMe);
const mockedPickPublicUserInfo = vi.mocked(pickPublicUserInfo);
const mockedReadMany = vi.mocked(readMany);
const mockedApplyRateLimit = vi.mocked(applyRateLimit);
const mockedRateLimitResponse = vi.mocked(rateLimitResponse);
const mockedAssertCsrfToken = vi.mocked(assertCsrfToken);
const mockedRotateCsrfCookie = vi.mocked(rotateCsrfCookie);

function makeContext(body: Record<string, unknown>): APIContext {
    const csrf = "csrf-token";
    return createMockAPIContext({
        method: "POST",
        url: "http://localhost:4321/api/auth/login",
        body,
        cookies: {
            cialli_csrf: csrf,
        },
        headers: {
            "x-csrf-token": csrf,
            "x-vercel-forwarded-for": "172.16.0.1",
        },
    }) as unknown as APIContext;
}

describe("/api/auth/login rate limit", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockedAssertCsrfToken.mockReturnValue(null);
        mockedReadMany.mockResolvedValue([]);
        mockedDirectusLogin.mockResolvedValue({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresMs: Date.now() + 15 * 60 * 1000,
        });
        mockedDirectusGetMe.mockResolvedValue({
            id: "user-1",
            email: "cialichannel@example.com",
            first_name: "Cia",
            last_name: "Lli",
            avatarId: undefined,
            role: undefined,
        });
        mockedPickPublicUserInfo.mockReturnValue({
            id: "user-1",
            email: "cialichannel@example.com",
            name: "Cia Lli",
            avatarUrl: undefined,
        });
    });

    it("applies IP and normalized-email rate limits", async () => {
        mockedApplyRateLimit
            .mockResolvedValueOnce({
                ok: true,
                remaining: 9,
                resetAt: Date.now() + 5 * 60 * 1000,
            })
            .mockResolvedValueOnce({
                ok: true,
                remaining: 7,
                resetAt: Date.now() + 5 * 60 * 1000,
            });

        const response = await POST(
            makeContext({
                email: " CIALIchannel@example.com ",
                password: "admin",
            }),
        );

        expect(response.status).toBe(200);
        expect(mockedApplyRateLimit).toHaveBeenNthCalledWith(
            1,
            "172.16.0.1",
            "auth",
        );
        expect(mockedApplyRateLimit).toHaveBeenNthCalledWith(
            2,
            "email:cialichannel@example.com",
            "auth",
        );
        expect(mockedRotateCsrfCookie).toHaveBeenCalledTimes(1);
        expect(response.headers.get("X-RateLimit-Remaining")).toBe("7");
    });

    it("returns 429 when email-dimension limit is exceeded", async () => {
        mockedApplyRateLimit
            .mockResolvedValueOnce({
                ok: true,
                remaining: 9,
                resetAt: Date.now() + 5 * 60 * 1000,
            })
            .mockResolvedValueOnce({
                ok: false,
                remaining: 0,
                resetAt: Date.now() + 5 * 60 * 1000,
            });
        mockedRateLimitResponse.mockReturnValue(
            new Response(
                JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }),
                { status: 429 },
            ),
        );

        const response = await POST(
            makeContext({
                email: "cialichannel@example.com",
                password: "wrong-password",
            }),
        );

        expect(response.status).toBe(429);
        expect(mockedRateLimitResponse).toHaveBeenCalledTimes(1);
        expect(mockedDirectusLogin).not.toHaveBeenCalled();
        expect(mockedRotateCsrfCookie).not.toHaveBeenCalled();
    });
});
