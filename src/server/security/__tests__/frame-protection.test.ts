import { describe, expect, it } from "vitest";

import {
    applyFrameProtectionHeaders,
    FRAME_ANCESTORS_POLICY,
    FRAME_ANCESTORS_SELF_POLICY,
    isHtmlResponse,
    isSameOriginClientHtmlFetch,
    isSameOriginFrameNavigation,
    mergeFrameAncestorsDirective,
    resolveFrameProtectionPolicy,
    shouldApplyFrameProtection,
    X_FRAME_OPTIONS_DENY,
    X_FRAME_OPTIONS_SAMEORIGIN,
} from "@/server/security/frame-protection";
import type { FrameProtectionRequestContext } from "@/server/security/frame-protection";

function createRequestContext(
    url: string,
    init?: RequestInit & { allowSameOriginFrameNavigation?: boolean },
): FrameProtectionRequestContext {
    const requestUrl = new URL(url);
    const { allowSameOriginFrameNavigation, ...requestInit } = init ?? {};
    return {
        url: requestUrl,
        request: new Request(requestUrl, requestInit),
        allowSameOriginFrameNavigation,
    };
}

describe("security/frame-protection", () => {
    it("识别 text/html 响应", () => {
        const response = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
            },
        });

        expect(isHtmlResponse(response)).toBe(true);
    });

    it("非 HTML 响应返回 false", () => {
        const jsonResponse = new Response('{"ok":true}', {
            headers: {
                "content-type": "application/json; charset=utf-8",
            },
        });
        const emptyResponse = new Response("ok");

        expect(isHtmlResponse(jsonResponse)).toBe(false);
        expect(isHtmlResponse(emptyResponse)).toBe(false);
    });

    it("空 CSP 时生成 frame-ancestors none", () => {
        expect(mergeFrameAncestorsDirective(null)).toBe(FRAME_ANCESTORS_POLICY);
        expect(mergeFrameAncestorsDirective("   ")).toBe(
            FRAME_ANCESTORS_POLICY,
        );
    });

    it("已有 CSP 且不含 frame-ancestors 时追加策略", () => {
        expect(
            mergeFrameAncestorsDirective(
                "default-src 'self'; object-src 'none'",
            ),
        ).toBe("default-src 'self'; object-src 'none'; frame-ancestors 'none'");
    });

    it("已有 frame-ancestors 时替换为 none", () => {
        expect(
            mergeFrameAncestorsDirective(
                "default-src 'self'; Frame-Ancestors https://evil.test; object-src 'none'",
            ),
        ).toBe("default-src 'self'; frame-ancestors 'none'; object-src 'none'");
    });

    it("可将已有 frame-ancestors 替换为 self", () => {
        expect(
            mergeFrameAncestorsDirective(
                "default-src 'self'; frame-ancestors 'none'",
                FRAME_ANCESTORS_SELF_POLICY,
            ),
        ).toBe("default-src 'self'; frame-ancestors 'self'");
    });

    it("本机地址不启用防嵌入头", () => {
        expect(
            shouldApplyFrameProtection({ url: new URL("https://localhost/") }),
        ).toBe(false);
        expect(
            shouldApplyFrameProtection({
                url: new URL("https://127.0.0.1/"),
            }),
        ).toBe(false);
        expect(
            shouldApplyFrameProtection({ url: new URL("https://[::1]/") }),
        ).toBe(false);
        expect(
            shouldApplyFrameProtection({
                url: new URL("https://example.com/"),
            }),
        ).toBe(true);
    });

    it("仅对 HTML 响应注入防嵌入头", () => {
        const htmlResponse = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
                "content-security-policy": "default-src 'self'",
            },
        });
        const jsonResponse = new Response('{"ok":true}', {
            headers: {
                "content-type": "application/json; charset=utf-8",
            },
        });

        applyFrameProtectionHeaders(htmlResponse, {
            url: new URL("https://example.com/"),
        });
        applyFrameProtectionHeaders(jsonResponse);

        expect(htmlResponse.headers.get("X-Frame-Options")).toBe(
            X_FRAME_OPTIONS_DENY,
        );
        expect(htmlResponse.headers.get("Content-Security-Policy")).toBe(
            "default-src 'self'; frame-ancestors 'none'",
        );
        expect(jsonResponse.headers.get("X-Frame-Options")).toBeNull();
        expect(jsonResponse.headers.get("Content-Security-Policy")).toBeNull();
    });

    it("本机 HTML 响应跳过防嵌入头", () => {
        const response = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
                "content-security-policy": "default-src 'self'",
            },
        });

        applyFrameProtectionHeaders(response, {
            url: new URL("https://localhost/"),
        });

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "default-src 'self'",
        );
    });

    it("远程顶层 HTML document 请求继续启用防嵌入头", () => {
        const context = createRequestContext("https://example.com/posts", {
            headers: {
                "sec-fetch-dest": "document",
                "sec-fetch-mode": "navigate",
                "upgrade-insecure-requests": "1",
            },
        });

        expect(shouldApplyFrameProtection(context)).toBe(true);
    });

    it("同源客户端 HTML fetch 请求跳过防嵌入头", () => {
        const context = createRequestContext("https://example.com/posts", {
            headers: {
                referer: "https://example.com/",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
            },
        });
        const response = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
            },
        });

        expect(isSameOriginClientHtmlFetch(context)).toBe(true);
        expect(shouldApplyFrameProtection(context)).toBe(false);

        applyFrameProtectionHeaders(response, context);

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBeNull();
    });

    it("跨站 cors HTML fetch 不会绕过防嵌入头", () => {
        const context = createRequestContext("https://example.com/posts", {
            headers: {
                referer: "https://other.example/",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "cross-site",
            },
        });

        expect(isSameOriginClientHtmlFetch(context)).toBe(false);
        expect(resolveFrameProtectionPolicy(context)).toBe("deny");
        expect(shouldApplyFrameProtection(context)).toBe(true);
    });

    it("同源 fetch metadata 可在缺少 Referer 时识别客户端 fetch", () => {
        const context = createRequestContext("https://example.com/posts", {
            headers: {
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
            },
        });

        expect(isSameOriginClientHtmlFetch(context)).toBe(true);
        expect(resolveFrameProtectionPolicy(context)).toBe("skip");
        expect(shouldApplyFrameProtection(context)).toBe(false);
    });

    it("缺少 fetch metadata 时同源 Referer 可作为客户端 fetch 兜底信号", () => {
        const context = createRequestContext("https://example.com/posts", {
            headers: {
                referer: "https://example.com/",
            },
        });

        expect(isSameOriginClientHtmlFetch(context)).toBe(true);
        expect(shouldApplyFrameProtection(context)).toBe(false);
    });

    it("无同源 Referer 的普通 HTML 请求继续启用防嵌入头", () => {
        const noRefererContext = createRequestContext(
            "https://example.com/posts",
        );
        const crossOriginRefererContext = createRequestContext(
            "https://example.com/posts",
            {
                headers: {
                    referer: "https://other.example/",
                },
            },
        );

        expect(shouldApplyFrameProtection(noRefererContext)).toBe(true);
        expect(shouldApplyFrameProtection(crossOriginRefererContext)).toBe(
            true,
        );
    });

    it("开发模式同源 iframe/frame 语义请求使用 SAMEORIGIN 策略", () => {
        const iframeContext = createRequestContext(
            "https://example.com/posts",
            {
                allowSameOriginFrameNavigation: true,
                headers: {
                    referer: "https://example.com/",
                    "sec-fetch-dest": "iframe",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                },
            },
        );
        const frameContext = createRequestContext("https://example.com/posts", {
            allowSameOriginFrameNavigation: true,
            headers: {
                referer: "https://example.com/",
                "sec-fetch-dest": "frame",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
            },
        });
        const response = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
                "content-security-policy": "default-src 'self'",
            },
        });

        expect(isSameOriginFrameNavigation(iframeContext)).toBe(true);
        expect(resolveFrameProtectionPolicy(iframeContext)).toBe(
            "same-origin-frame",
        );
        expect(shouldApplyFrameProtection(iframeContext)).toBe(true);
        expect(resolveFrameProtectionPolicy(frameContext)).toBe(
            "same-origin-frame",
        );

        applyFrameProtectionHeaders(response, iframeContext);

        expect(response.headers.get("X-Frame-Options")).toBe(
            X_FRAME_OPTIONS_SAMEORIGIN,
        );
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "default-src 'self'; frame-ancestors 'self'",
        );
    });

    it("生产模式 iframe/frame/document 语义请求继续使用 DENY 策略", () => {
        const iframeContext = createRequestContext(
            "https://example.com/posts",
            {
                headers: {
                    referer: "https://example.com/",
                    "sec-fetch-dest": "iframe",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "same-origin",
                },
            },
        );
        const frameContext = createRequestContext("https://example.com/posts", {
            headers: {
                referer: "https://example.com/",
                "sec-fetch-dest": "frame",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "same-origin",
            },
        });
        const documentContext = createRequestContext(
            "https://example.com/posts",
            {
                headers: {
                    referer: "https://example.com/",
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "upgrade-insecure-requests": "1",
                },
            },
        );
        const response = new Response("<html></html>", {
            headers: {
                "content-type": "text/html; charset=utf-8",
            },
        });

        expect(isSameOriginFrameNavigation(iframeContext)).toBe(false);
        expect(resolveFrameProtectionPolicy(iframeContext)).toBe("deny");
        expect(shouldApplyFrameProtection(iframeContext)).toBe(true);
        expect(resolveFrameProtectionPolicy(frameContext)).toBe("deny");
        expect(shouldApplyFrameProtection(frameContext)).toBe(true);
        expect(shouldApplyFrameProtection(documentContext)).toBe(true);

        applyFrameProtectionHeaders(response, iframeContext);

        expect(response.headers.get("X-Frame-Options")).toBe(
            X_FRAME_OPTIONS_DENY,
        );
        expect(response.headers.get("Content-Security-Policy")).toBe(
            FRAME_ANCESTORS_POLICY,
        );
    });

    it("开发模式跨源 iframe 仍继续使用 DENY 策略", () => {
        const context = createRequestContext("https://example.com/posts", {
            allowSameOriginFrameNavigation: true,
            headers: {
                referer: "https://evil.example/",
                "sec-fetch-dest": "iframe",
                "sec-fetch-mode": "navigate",
                "sec-fetch-site": "cross-site",
            },
        });

        expect(isSameOriginFrameNavigation(context)).toBe(false);
        expect(resolveFrameProtectionPolicy(context)).toBe("deny");
        expect(shouldApplyFrameProtection(context)).toBe(true);
    });
});
