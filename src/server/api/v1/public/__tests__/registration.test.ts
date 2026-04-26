import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMockAPIContext } from "@/__tests__/helpers/mock-api-context";
import { AppError } from "@/server/api/errors";
import { REGISTRATION_REQUEST_COOKIE_NAME } from "@/server/auth/registration-request-cookie";

const mocks = vi.hoisted(() => ({
    createPublicRegistration: vi.fn(),
    cancelPublicRegistration: vi.fn(),
    replacePublicRegistrationAvatar: vi.fn(),
    loadAuthorizedRegistrationAvatar: vi.fn(),
    checkPublicRegistrationAvailability: vi.fn(),
    applyRateLimit: vi.fn(),
    rateLimitResponse: vi.fn(),
}));

vi.mock(
    "@/server/application/registration/public-registration.service",
    () => ({
        createPublicRegistration: mocks.createPublicRegistration,
        cancelPublicRegistration: mocks.cancelPublicRegistration,
        replacePublicRegistrationAvatar: mocks.replacePublicRegistrationAvatar,
        loadAuthorizedRegistrationAvatar:
            mocks.loadAuthorizedRegistrationAvatar,
        checkPublicRegistrationAvailability:
            mocks.checkPublicRegistrationAvailability,
    }),
);

vi.mock("@/server/directus-auth", () => ({
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
    getCookieOptions: vi.fn(() => ({ path: "/" })),
}));

vi.mock("@/server/security/rate-limit", () => ({
    applyRateLimit: mocks.applyRateLimit,
    rateLimitResponse: mocks.rateLimitResponse,
}));

import {
    handlePublicRegistrationCheck,
    handlePublicRegistrationRequests,
} from "@/server/api/v1/public/registration";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function makeMultipartRequestContext(params: {
    method: string;
    url: string;
    segments: string;
    formData?: FormData;
    cookies?: Record<string, string>;
}): APIContext {
    const context = createMockAPIContext({
        method: params.method,
        url: params.url,
        params: { segments: params.segments },
        formData: params.formData,
        cookies: params.cookies,
    }) as unknown as APIContext;
    const locals = context.locals as unknown as {
        siteSettings?: {
            settings: {
                auth: {
                    register_enabled: boolean;
                };
            };
        };
    };
    locals.siteSettings = {
        settings: {
            auth: {
                register_enabled: true,
            },
        },
    };
    return context;
}

describe("public registration routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("POST /registration-requests accepts multipart form data and sets request cookie", async () => {
        mocks.createPublicRegistration.mockResolvedValue({ id: REQUEST_ID });

        const formData = new FormData();
        formData.append("email", "user@example.com");
        formData.append("username", "user");
        formData.append("display_name", "User");
        formData.append("password", "password1");
        formData.append("registration_reason", "hello");
        formData.append(
            "avatar",
            new File(["avatar"], "avatar.jpg", { type: "image/jpeg" }),
        );

        const context = makeMultipartRequestContext({
            method: "POST",
            url: "http://localhost:4321/api/v1/public/registration-requests",
            segments: "public/registration-requests",
            formData,
        });

        const response = await handlePublicRegistrationRequests(context, [
            "public",
            "registration-requests",
        ]);

        expect(response.status).toBe(200);
        expect(mocks.createPublicRegistration).toHaveBeenCalledWith(
            expect.objectContaining({
                email: "user@example.com",
                username: "user",
                displayName: "User",
                avatar: expect.any(File),
            }),
        );
        expect(
            context.cookies.get(REGISTRATION_REQUEST_COOKIE_NAME)?.value,
        ).toBe(REQUEST_ID);
    });

    it("PATCH /registration-requests/:id/avatar parses multipart avatar uploads", async () => {
        mocks.replacePublicRegistrationAvatar.mockResolvedValue({
            id: "request-1",
        });

        const formData = new FormData();
        formData.append(
            "avatar",
            new File(["avatar"], "avatar.jpg", { type: "image/jpeg" }),
        );

        const context = makeMultipartRequestContext({
            method: "PATCH",
            url: `http://localhost:4321/api/v1/public/registration-requests/${REQUEST_ID}/avatar`,
            segments: `public/registration-requests/${REQUEST_ID}/avatar`,
            formData,
            cookies: {
                [REGISTRATION_REQUEST_COOKIE_NAME]: REQUEST_ID,
            },
        });

        const response = await handlePublicRegistrationRequests(context, [
            "public",
            "registration-requests",
            REQUEST_ID,
            "avatar",
        ]);

        expect(response.status).toBe(200);
        expect(mocks.replacePublicRegistrationAvatar).toHaveBeenCalledWith({
            requestId: REQUEST_ID,
            cookieRequestId: REQUEST_ID,
            avatar: expect.any(File),
        });
    });

    it("GET /registration-check without fields returns stable error code", async () => {
        mocks.applyRateLimit.mockResolvedValue({
            ok: true,
            remaining: 10,
            resetAt: Date.now() + 60_000,
        });

        const context = makeMultipartRequestContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/public/registration-check",
            segments: "public/registration-check",
        });

        const response = await handlePublicRegistrationCheck(context, [
            "public",
            "registration-check",
        ]);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: {
                code: "REGISTRATION_CHECK_QUERY_REQUIRED",
                message: "至少提供邮箱或用户名",
            },
        });
        expect(
            mocks.checkPublicRegistrationAvailability,
        ).not.toHaveBeenCalled();
    });

    it("GET /registration-requests/:id/avatar streams the private avatar response", async () => {
        mocks.loadAuthorizedRegistrationAvatar.mockResolvedValue(
            new Response("avatar-bytes", {
                status: 200,
                headers: {
                    "content-type": "image/jpeg",
                    etag: "test-etag",
                },
            }),
        );

        const context = makeMultipartRequestContext({
            method: "GET",
            url: `http://localhost:4321/api/v1/public/registration-requests/${REQUEST_ID}/avatar`,
            segments: `public/registration-requests/${REQUEST_ID}/avatar`,
            cookies: {
                [REGISTRATION_REQUEST_COOKIE_NAME]: REQUEST_ID,
            },
        });

        const response = await handlePublicRegistrationRequests(context, [
            "public",
            "registration-requests",
            REQUEST_ID,
            "avatar",
        ]);

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.text()).toBe("avatar-bytes");
    });

    it("GET /registration-requests/:id/avatar maps auth failures to 404", async () => {
        mocks.loadAuthorizedRegistrationAvatar.mockRejectedValue(
            new AppError("REGISTRATION_NOT_FOUND", "not found", 403),
        );

        const context = makeMultipartRequestContext({
            method: "GET",
            url: `http://localhost:4321/api/v1/public/registration-requests/${REQUEST_ID}/avatar`,
            segments: `public/registration-requests/${REQUEST_ID}/avatar`,
            cookies: {
                [REGISTRATION_REQUEST_COOKIE_NAME]: REQUEST_ID,
            },
        });

        const response = await handlePublicRegistrationRequests(context, [
            "public",
            "registration-requests",
            REQUEST_ID,
            "avatar",
        ]);

        expect(response.status).toBe(404);
    });
});
