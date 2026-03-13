import { describe, expect, it } from "vitest";
import {
    normalizeNavigationPathname,
    shouldIgnoreSamePageNavigation,
} from "../navigation-dedupe";

describe("normalizeNavigationPathname", () => {
    it("应将空路径归一化为根路径", () => {
        expect(normalizeNavigationPathname("")).toBe("/");
    });

    it("应移除非根路径的尾斜杠", () => {
        expect(normalizeNavigationPathname("/me/")).toBe("/me");
        expect(normalizeNavigationPathname("/me////")).toBe("/me");
    });

    it("应保留根路径", () => {
        expect(normalizeNavigationPathname("/")).toBe("/");
    });
});

describe("shouldIgnoreSamePageNavigation", () => {
    it("当 pathname/search/hash 完全相同时应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me");
        const targetUrl = new URL("https://cialli.example/me/");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: null,
                hasDownload: false,
            }),
        ).toBe(true);
    });

    it("hash 不同时不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me#diary");
        const targetUrl = new URL("https://cialli.example/me#albums");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: null,
                hasDownload: false,
            }),
        ).toBe(false);
    });

    it("query 不同时不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/posts?tag=a");
        const targetUrl = new URL("https://cialli.example/posts?tag=b");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: null,
                hasDownload: false,
            }),
        ).toBe(false);
    });

    it("跨域链接不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me");
        const targetUrl = new URL("https://another.example/me");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: null,
                hasDownload: false,
            }),
        ).toBe(false);
    });

    it("非 http/https 协议不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me");
        const targetUrl = new URL("mailto:test@cialli.example");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: null,
                hasDownload: false,
            }),
        ).toBe(false);
    });

    it("target 非 _self 不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me");
        const targetUrl = new URL("https://cialli.example/me");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: "_blank",
                hasDownload: false,
            }),
        ).toBe(false);
    });

    it("download 链接不应忽略导航", () => {
        const currentUrl = new URL("https://cialli.example/me");
        const targetUrl = new URL("https://cialli.example/me");

        expect(
            shouldIgnoreSamePageNavigation({
                currentUrl,
                targetUrl,
                targetAttr: "_self",
                hasDownload: true,
            }),
        ).toBe(false);
    });
});
