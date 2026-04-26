import { describe, expect, it } from "vitest";

import {
    AUTH_PROTECTED_TARGET_ATTR,
    updateAnchorForAuth,
} from "@/scripts/auth/nav-routing";

const BASE_ORIGIN = "http://localhost:4321";

function makeAnchor(href: string): HTMLAnchorElement {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    document.body.append(anchor);
    return anchor;
}

describe("auth nav routing", () => {
    it("keeps Account Settings on /me for logged-in users", () => {
        const anchor = makeAnchor("/me");

        updateAnchorForAuth(
            anchor,
            { username: "alice", isLoggedIn: true },
            BASE_ORIGIN,
        );

        expect(anchor.getAttribute("href")).toBe("/me");
        expect(anchor.hasAttribute("data-needs-login")).toBe(false);
        expect(anchor.hasAttribute(AUTH_PROTECTED_TARGET_ATTR)).toBe(false);
    });

    it("protects Account Settings on /me for logged-out users", () => {
        const anchor = makeAnchor("/me");

        updateAnchorForAuth(
            anchor,
            { username: "", isLoggedIn: false },
            BASE_ORIGIN,
        );

        expect(anchor.getAttribute("href")).toBe("#");
        expect(anchor.getAttribute(AUTH_PROTECTED_TARGET_ATTR)).toBe("/me");
        expect(anchor.hasAttribute("data-needs-login")).toBe(true);
    });

    it.each([
        ["/__user__", "/alice"],
        ["/__user__/albums", "/alice/albums"],
        ["/__user__/diary", "/alice/diary"],
        ["/__user__/bangumi", "/alice/bangumi"],
    ])("resolves %s to %s for the current username", (href, expected) => {
        const anchor = makeAnchor(href);

        updateAnchorForAuth(
            anchor,
            { username: "alice", isLoggedIn: true },
            BASE_ORIGIN,
        );

        expect(anchor.getAttribute("href")).toBe(expected);
        expect(anchor.hasAttribute("data-needs-login")).toBe(false);
        expect(anchor.hasAttribute(AUTH_PROTECTED_TARGET_ATTR)).toBe(false);
    });

    it("protects user placeholder links instead of leaking /__user__", () => {
        const anchor = makeAnchor("/__user__/albums");

        updateAnchorForAuth(
            anchor,
            { username: "", isLoggedIn: false },
            BASE_ORIGIN,
        );

        expect(anchor.getAttribute("href")).toBe("#");
        expect(anchor.getAttribute(AUTH_PROTECTED_TARGET_ATTR)).toBe(
            "/__user__/albums",
        );
        expect(anchor.hasAttribute("data-needs-login")).toBe(true);
    });

    it("does not rewrite admin links through user placeholder routing", () => {
        const anchor = makeAnchor("/admin");

        updateAnchorForAuth(
            anchor,
            { username: "alice", isLoggedIn: true },
            BASE_ORIGIN,
        );

        expect(anchor.getAttribute("href")).toBe("/admin");
        expect(anchor.hasAttribute("data-needs-login")).toBe(false);
        expect(anchor.hasAttribute(AUTH_PROTECTED_TARGET_ATTR)).toBe(false);
    });
});
