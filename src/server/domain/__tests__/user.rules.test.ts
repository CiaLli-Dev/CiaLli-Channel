import { describe, it, expect } from "vitest";

import {
    isProfilePubliclyVisible,
    isModuleVisibleOnProfile,
    hasPermission,
    isOwner,
    canModifyResource,
} from "../user/user.rules";
import { mockProfile, mockPermissions } from "@/__tests__/helpers";

// ── Profile 公开性 ──

describe("isProfilePubliclyVisible", () => {
    it("owner 总是可见", () => {
        const profile = mockProfile({ profile_public: false });
        expect(isProfilePubliclyVisible(profile, true)).toBe(true);
    });

    it("非 owner + profile_public=true → 可见", () => {
        const profile = mockProfile({ profile_public: true });
        expect(isProfilePubliclyVisible(profile, false)).toBe(true);
    });

    it("非 owner + profile_public=false → 不可见", () => {
        const profile = mockProfile({ profile_public: false });
        expect(isProfilePubliclyVisible(profile, false)).toBe(false);
    });
});

// ── 模块可见性 ──

describe("isModuleVisibleOnProfile", () => {
    it("owner 总是可见", () => {
        const profile = mockProfile({ show_articles_on_profile: false });
        expect(isModuleVisibleOnProfile(profile, "articles", true)).toBe(true);
    });

    it("非 owner + 模块开启 → 可见", () => {
        const profile = mockProfile({ show_diaries_on_profile: true });
        expect(isModuleVisibleOnProfile(profile, "diaries", false)).toBe(true);
    });

    it("非 owner + 模块关闭 → 不可见", () => {
        const profile = mockProfile({ show_bangumi_on_profile: false });
        expect(isModuleVisibleOnProfile(profile, "bangumi", false)).toBe(false);
    });

    it("覆盖所有模块", () => {
        const profile = mockProfile({
            show_albums_on_profile: false,
            show_comments_on_profile: false,
        });
        expect(isModuleVisibleOnProfile(profile, "albums", false)).toBe(false);
        expect(isModuleVisibleOnProfile(profile, "comments", false)).toBe(
            false,
        );
    });
});

// ── 权限判定 ──

describe("hasPermission", () => {
    it("admin 直接放行", () => {
        const perms = mockPermissions({ can_publish_articles: false });
        expect(hasPermission(perms, "can_publish_articles", true)).toBe(true);
    });

    it("非 admin + 权限为 true → 通过", () => {
        const perms = mockPermissions({ can_publish_articles: true });
        expect(hasPermission(perms, "can_publish_articles", false)).toBe(true);
    });

    it("非 admin + 权限为 false → 拒绝", () => {
        const perms = mockPermissions({ can_publish_articles: false });
        expect(hasPermission(perms, "can_publish_articles", false)).toBe(false);
    });
});

// ── 所有权判定 ──

describe("isOwner", () => {
    it("viewerId === ownerId → true", () => {
        expect(isOwner("user-1", "user-1")).toBe(true);
    });

    it("viewerId !== ownerId → false", () => {
        expect(isOwner("user-1", "user-2")).toBe(false);
    });

    it("viewerId=null → false", () => {
        expect(isOwner(null, "user-1")).toBe(false);
    });
});

describe("canModifyResource", () => {
    it("owner 可以修改", () => {
        expect(canModifyResource("user-1", "user-1", false)).toBe(true);
    });

    it("非 owner 不可以修改", () => {
        expect(canModifyResource("user-1", "user-2", false)).toBe(false);
    });

    it("admin 可以修改", () => {
        expect(canModifyResource("admin-1", "user-2", true)).toBe(true);
    });
});
