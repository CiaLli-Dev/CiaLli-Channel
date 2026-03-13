import { describe, it, expect } from "vitest";

import { isPubliclyVisible, isVisibleOnProfile } from "../shared/visibility";

describe("isPubliclyVisible", () => {
    it("published + is_public → true", () => {
        expect(
            isPubliclyVisible({ status: "published", is_public: true }),
        ).toBe(true);
    });

    it("draft + is_public → false", () => {
        expect(isPubliclyVisible({ status: "draft", is_public: true })).toBe(
            false,
        );
    });

    it("published + !is_public → false", () => {
        expect(
            isPubliclyVisible({ status: "published", is_public: false }),
        ).toBe(false);
    });

    it("archived + is_public → false", () => {
        expect(isPubliclyVisible({ status: "archived", is_public: true })).toBe(
            false,
        );
    });
});

describe("isVisibleOnProfile", () => {
    const publicItem = {
        status: "published" as const,
        is_public: true,
        show_on_profile: true,
    };

    it("owner 总是可见", () => {
        const hidden = {
            status: "draft" as const,
            is_public: false,
            show_on_profile: false,
        };
        expect(isVisibleOnProfile(hidden, true)).toBe(true);
    });

    it("非 owner: published + is_public + show_on_profile → true", () => {
        expect(isVisibleOnProfile(publicItem, false)).toBe(true);
    });

    it("非 owner: show_on_profile=false → false", () => {
        expect(
            isVisibleOnProfile(
                { ...publicItem, show_on_profile: false },
                false,
            ),
        ).toBe(false);
    });

    it("非 owner: is_public=false → false", () => {
        expect(
            isVisibleOnProfile({ ...publicItem, is_public: false }, false),
        ).toBe(false);
    });

    it("非 owner: status=draft → false", () => {
        expect(
            isVisibleOnProfile(
                { ...publicItem, status: "draft" as const },
                false,
            ),
        ).toBe(false);
    });
});
