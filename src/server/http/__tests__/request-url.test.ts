import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalAppSiteUrl = process.env.APP_SITE_URL;
const originalAppTrustProxy = process.env.APP_TRUST_PROXY;

beforeEach(() => {
    vi.resetModules();
    delete process.env.APP_SITE_URL;
    delete process.env.APP_TRUST_PROXY;
});

afterEach(() => {
    if (originalAppSiteUrl === undefined) {
        delete process.env.APP_SITE_URL;
    } else {
        process.env.APP_SITE_URL = originalAppSiteUrl;
    }

    if (originalAppTrustProxy === undefined) {
        delete process.env.APP_TRUST_PROXY;
    } else {
        process.env.APP_TRUST_PROXY = originalAppTrustProxy;
    }
});

describe("server/http/request-url", () => {
    it("未启用代理信任时使用请求自身 origin", async () => {
        const { resolveCanonicalSiteUrl, resolveRequestOrigin } =
            await import("@/server/http/request-url");

        const request = new Request("http://127.0.0.1:4321/posts");
        const url = new URL(request.url);

        expect(
            resolveRequestOrigin({
                request,
                url,
                headers: request.headers,
            }),
        ).toBe("http://127.0.0.1:4321");
        expect(
            resolveCanonicalSiteUrl({
                request,
                url,
                headers: request.headers,
            }).href,
        ).toBe("http://127.0.0.1:4321/");
    });

    it("配置 APP_SITE_URL 时优先使用显式站点地址", async () => {
        process.env.APP_SITE_URL = "https://demo.example.com";

        const { resolveCanonicalSiteUrl } =
            await import("@/server/http/request-url");

        const request = new Request("http://127.0.0.1:4321/posts");
        const url = new URL(request.url);

        expect(
            resolveCanonicalSiteUrl({
                request,
                url,
                headers: request.headers,
            }).href,
        ).toBe("https://demo.example.com/");
    });

    it("启用 APP_TRUST_PROXY 时接受 X-Forwarded-* 头", async () => {
        process.env.APP_TRUST_PROXY = "1";

        const { isSecureRequest, resolveRequestOrigin } =
            await import("@/server/http/request-url");

        const headers = new Headers({
            host: "internal:4321",
            "x-forwarded-host": "preview.example.com",
            "x-forwarded-proto": "https",
        });

        expect(
            resolveRequestOrigin({
                headers,
                url: new URL("http://internal:4321/posts"),
            }),
        ).toBe("https://preview.example.com");
        expect(
            isSecureRequest({
                headers,
                url: new URL("http://internal:4321/posts"),
            }),
        ).toBe(true);
    });
});
