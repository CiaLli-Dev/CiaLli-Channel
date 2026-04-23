// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProtectionHelpersWindow = Window &
    typeof globalThis & {
        __ppSanitizeDecryptedHtml?: (rawHtml: unknown) => string;
    };

describe("protection-helpers", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        delete (window as ProtectionHelpersWindow).__ppSanitizeDecryptedHtml;
    });

    it("removes dangerous URL schemes from decrypted HTML", async () => {
        await import("@/scripts/auth/protection-helpers");

        const sanitize = (window as ProtectionHelpersWindow)
            .__ppSanitizeDecryptedHtml;

        expect(typeof sanitize).toBe("function");

        const sanitized = sanitize?.(`
            <a id="js-link" href="javascript:alert(1)">bad</a>
            <a id="data-link" href="data:text/html,evil">bad</a>
            <a id="vb-link" href="vbscript:msgbox(1)">bad</a>
            <img id="img" src="data:image/svg+xml,<svg></svg>" />
            <iframe id="frame" src=" https://example.com/embed "></iframe>
            <a id="relative" href="/safe/path">ok</a>
            <a id="mailto" href="mailto:test@example.com">ok</a>
        `);

        const parsed = new DOMParser().parseFromString(
            String(sanitized || ""),
            "text/html",
        );

        expect(parsed.getElementById("js-link")?.getAttribute("href")).toBe(
            null,
        );
        expect(parsed.getElementById("data-link")?.getAttribute("href")).toBe(
            null,
        );
        expect(parsed.getElementById("vb-link")?.getAttribute("href")).toBe(
            null,
        );
        expect(parsed.getElementById("img")?.getAttribute("src")).toBe(null);
        expect(parsed.getElementById("frame")?.getAttribute("src")).toBe(
            " https://example.com/embed ",
        );
        expect(parsed.getElementById("relative")?.getAttribute("href")).toBe(
            "/safe/path",
        );
        expect(parsed.getElementById("mailto")?.getAttribute("href")).toBe(
            "mailto:test@example.com",
        );
    });
});
