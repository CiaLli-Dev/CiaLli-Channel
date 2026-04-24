import type { APIContext, MiddlewareNext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assertRequiredEnvMock = vi.fn();
const getResolvedSiteSettingsMock = vi.fn();
const runWithRequestContextMock = vi.fn();
const ensureCsrfCookieMock = vi.fn();
const registerRequestScopedI18nMock = vi.fn();
const originalNodeEnv = process.env.NODE_ENV;

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
    requestInit?: RequestInit,
): APIContext {
    const url = new URL(pathname, origin);
    const context: {
        isPrerendered: boolean;
        request: Request;
        url: URL;
        locals: Record<string, unknown>;
        cookies: MockCookies;
    } = {
        isPrerendered: false,
        request: new Request(url, requestInit),
        url,
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

function setNodeEnv(value: string | undefined): void {
    if (value === undefined) {
        delete process.env.NODE_ENV;
        return;
    }

    process.env.NODE_ENV = value;
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setNodeEnv(originalNodeEnv);

    getResolvedSiteSettingsMock.mockResolvedValue({
        system: { lang: "zh-CN" },
    });
    runWithRequestContextMock.mockImplementation(async (_context, callback) => {
        return await callback();
    });
    ensureCsrfCookieMock.mockReturnValue("csrf-token");
});

afterEach(() => {
    setNodeEnv(originalNodeEnv);
});

describe("middleware frame protection", () => {
    it("远程普通 HTML 响应附加 DENY 与 frame-ancestors none", async () => {
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
                createContext("/posts", "http://192.168.1.20", {
                    headers: {
                        "sec-fetch-dest": "document",
                        "sec-fetch-mode": "navigate",
                        "upgrade-insecure-requests": "1",
                    },
                }),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBe("DENY");
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "frame-ancestors 'none'",
        );
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("同源 Astro 客户端导航 fetch 不附加防嵌入头", async () => {
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response("<html>posts</html>", {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext("/posts", "http://192.168.1.20", {
                    headers: {
                        referer: "http://192.168.1.20/",
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-site": "same-origin",
                    },
                }),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBeNull();
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("开发模式同源 Astro 隐藏 iframe 使用 SAMEORIGIN 策略", async () => {
        setNodeEnv("development");
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response("<html>posts</html>", {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext(
                    "/posts/CLtR47Cf7U6c",
                    "http://192.168.1.20",
                    {
                        headers: {
                            referer: "http://192.168.1.20/",
                            "sec-fetch-dest": "iframe",
                            "sec-fetch-mode": "navigate",
                            "sec-fetch-site": "same-origin",
                        },
                    },
                ),
                next as unknown as MiddlewareNext,
            ),
        );

        expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "frame-ancestors 'self'",
        );
        expect(response.headers.get("X-Request-ID")).toBeTruthy();
    });

    it("非开发模式同源 iframe 仍使用 DENY 策略", async () => {
        setNodeEnv("production");
        const { onRequest } = await import("@/middleware");
        const next = vi.fn().mockResolvedValue(
            new Response("<html>posts</html>", {
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const response = assertResponse(
            await onRequest(
                createContext(
                    "/posts/CLtR47Cf7U6c",
                    "http://192.168.1.20",
                    {
                        headers: {
                            referer: "http://192.168.1.20/",
                            "sec-fetch-dest": "iframe",
                            "sec-fetch-mode": "navigate",
                            "sec-fetch-site": "same-origin",
                        },
                    },
                ),
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
