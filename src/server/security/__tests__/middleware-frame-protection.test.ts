import type { APIContext, MiddlewareNext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assertRequiredEnvMock = vi.fn();
const getResolvedSiteSettingsMock = vi.fn();
const runWithRequestContextMock = vi.fn();
const ensureCsrfCookieMock = vi.fn();
const registerRequestScopedI18nMock = vi.fn();

vi.mock("astro:middleware", () => ({
    defineMiddleware: (handler: unknown) => handler,
}));

vi.mock("@/server/env/required", () => ({
    assertRequiredEnv: assertRequiredEnvMock,
}));

vi.mock("@/server/site-settings/service", () => ({
    getResolvedSiteSettings: getResolvedSiteSettingsMock,
}));

vi.mock("@/server/request-context", () => ({
    runWithRequestContext: runWithRequestContextMock,
}));

vi.mock("@/server/security/csrf", () => ({
    ensureCsrfCookie: ensureCsrfCookieMock,
}));

vi.mock("@/server/request-context/i18n", () => ({
    registerRequestScopedI18n: registerRequestScopedI18nMock,
}));

type MockCookies = {
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options?: Record<string, unknown>): void;
};

function createContext(
    pathname: string,
    origin = "https://example.com",
): APIContext {
    const context: {
        isPrerendered: boolean;
        request: Request;
        url: URL;
        locals: Record<string, unknown>;
        cookies: MockCookies;
    } = {
        isPrerendered: false,
        request: new Request(new URL(pathname, origin)),
        url: new URL(pathname, origin),
        locals: {},
        cookies: {
            get(): undefined {
                return undefined;
            },
            set(): void {},
        },
    };

    return context as unknown as APIContext;
}

function assertResponse(response: Response | void): Response {
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) {
        throw new Error("Expected middleware to return a Response");
    }

    return response;
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getResolvedSiteSettingsMock.mockResolvedValue({
        system: { lang: "zh-CN" },
    });
    runWithRequestContextMock.mockImplementation(async (_context, callback) => {
        return await callback();
    });
    ensureCsrfCookieMock.mockReturnValue("csrf-token");
});

describe("middleware frame protection", () => {
    it("HTML 响应附加 DENY 与 frame-ancestors none", async () => {
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response("<html>login</html>", {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext("/auth/login", "https://example.com"),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBe("DENY");
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "frame-ancestors 'none'",
        );
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("localhost HTML 响应跳过防嵌入头", async () => {
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response("<html>login</html>", {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext("/auth/login", "https://localhost"),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBeNull();
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("非 HTML 响应不注入防嵌入头", async () => {
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response('{"ok":true}', {
                headers: {
                    "content-type": "application/json; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext(
                    "/api/v1/public/site-settings",
                    "https://example.com",
                ),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBeNull();
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });
});
