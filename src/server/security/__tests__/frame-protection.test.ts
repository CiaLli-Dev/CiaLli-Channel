import { describe, expect, it } from "vitest";

import {
    applyFrameProtectionHeaders,
    FRAME_ANCESTORS_POLICY,
    isHtmlResponse,
    mergeFrameAncestorsDirective,
    shouldApplyFrameProtection,
    X_FRAME_OPTIONS_DENY,
} from "@/server/security/frame-protection";

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

    it("本机地址不启用防嵌入头", () => {
        expect(shouldApplyFrameProtection(new URL("https://localhost/"))).toBe(
            false,
        );
        expect(shouldApplyFrameProtection(new URL("https://127.0.0.1/"))).toBe(
            false,
        );
        expect(shouldApplyFrameProtection(new URL("https://[::1]/"))).toBe(
            false,
        );
        expect(
            shouldApplyFrameProtection(new URL("https://example.com/")),
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

        applyFrameProtectionHeaders(
            htmlResponse,
            new URL("https://example.com/"),
        );
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

        applyFrameProtectionHeaders(response, new URL("https://localhost/"));

        expect(response.headers.get("X-Frame-Options")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "default-src 'self'",
        );
    });
});
