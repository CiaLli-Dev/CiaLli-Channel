import { describe, expect, it } from "vitest";

import { resolvePublicBaseUrl } from "@/config/public-base-url.mjs";

describe("resolvePublicBaseUrl", () => {
    it("normalizes root URLs to origin and trailing-slash siteURL", () => {
        expect(
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://example.com",
            }),
        ).toEqual({
            origin: "https://example.com",
            siteURL: "https://example.com/",
            hostname: "example.com",
            host: "example.com",
            protocol: "https:",
            port: "",
        });

        expect(
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://example.com/",
            }).siteURL,
        ).toBe("https://example.com/");
    });

    it("supports ports and IP addresses", () => {
        expect(
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://demo.example.com:8443",
            }),
        ).toMatchObject({
            origin: "https://demo.example.com:8443",
            host: "demo.example.com:8443",
            hostname: "demo.example.com",
            port: "8443",
        });

        expect(
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "http://203.0.113.10",
            }),
        ).toMatchObject({
            origin: "http://203.0.113.10",
            hostname: "203.0.113.10",
            protocol: "http:",
        });
    });

    it("falls back to SITE when APP_PUBLIC_BASE_URL is unavailable", () => {
        expect(
            resolvePublicBaseUrl(
                {
                    SITE: "https://astro.example.com/",
                },
                {
                    fallbackKeys: ["SITE"],
                },
            ),
        ).toMatchObject({
            origin: "https://astro.example.com",
            siteURL: "https://astro.example.com/",
        });
    });

    it("rejects invalid root URLs", () => {
        expect(() =>
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://example.com/foo",
            }),
        ).toThrow("must point to the site root");

        expect(() =>
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://example.com?x=1",
            }),
        ).toThrow("must not include a query string");

        expect(() =>
            resolvePublicBaseUrl({
                APP_PUBLIC_BASE_URL: "https://example.com/#hash",
            }),
        ).toThrow("must not include a hash fragment");
    });
});
