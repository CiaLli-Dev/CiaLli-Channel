import { describe, it, expect, vi, beforeEach } from "vitest";

import { AppError } from "@/server/api/errors";
import { mockProfile } from "@/__tests__/helpers/mock-data";

// ── mock 依赖 ──

vi.mock("@/server/domain/user/user.repository", () => ({
    findProfileByUsername: vi.fn(),
    findProfileByUserId: vi.fn(),
    updateProfile: vi.fn(),
    isUsernameAvailable: vi.fn(),
}));

import * as userRepo from "@/server/domain/user/user.repository";
import {
    getProfileByUsername,
    getProfileByUserId,
    checkProfileVisible,
    checkModuleVisible,
    updateProfile,
    ensureUsernameAvailable,
} from "@/server/domain/user/user.service";

const mockedRepo = vi.mocked(userRepo);

beforeEach(() => {
    vi.clearAllMocks();
});

// ── getProfileByUsername ──

describe("getProfileByUsername", () => {
    it("存在 → 返回 profile", async () => {
        const profile = mockProfile({ username: "alice" });
        mockedRepo.findProfileByUsername.mockResolvedValue(profile);

        const result = await getProfileByUsername("alice");
        expect(result).toEqual(profile);
        expect(mockedRepo.findProfileByUsername).toHaveBeenCalledWith("alice");
    });

    it("不存在 → 返回 null", async () => {
        mockedRepo.findProfileByUsername.mockResolvedValue(null);

        const result = await getProfileByUsername("nobody");
        expect(result).toBeNull();
    });
});

// ── getProfileByUserId ──

describe("getProfileByUserId", () => {
    it("存在 → 返回 profile", async () => {
        const profile = mockProfile({ user_id: "u-1" });
        mockedRepo.findProfileByUserId.mockResolvedValue(profile);

        const result = await getProfileByUserId("u-1");
        expect(result).toEqual(profile);
    });

    it("不存在 → 返回 null", async () => {
        mockedRepo.findProfileByUserId.mockResolvedValue(null);

        const result = await getProfileByUserId("no-user");
        expect(result).toBeNull();
    });
});

// ── checkProfileVisible ──

describe("checkProfileVisible", () => {
    it("公开 profile → 任何人可见", () => {
        const profile = mockProfile({ profile_public: true, user_id: "u-1" });
        expect(checkProfileVisible(profile, null)).toBe(true);
        expect(checkProfileVisible(profile, "other-user")).toBe(true);
    });

    it("私密 profile → 非 owner 不可见", () => {
        const profile = mockProfile({ profile_public: false, user_id: "u-1" });
        expect(checkProfileVisible(profile, null)).toBe(false);
        expect(checkProfileVisible(profile, "other-user")).toBe(false);
    });

    it("私密 profile → owner 可见", () => {
        const profile = mockProfile({ profile_public: false, user_id: "u-1" });
        expect(checkProfileVisible(profile, "u-1")).toBe(true);
    });
});

// ── checkModuleVisible ──

describe("checkModuleVisible", () => {
    it("模块开启 + profile 公开 → 可见", () => {
        const profile = mockProfile({
            profile_public: true,
            show_articles_on_profile: true,
        });
        expect(checkModuleVisible(profile, "articles", "other-user")).toBe(
            true,
        );
    });

    it("模块关闭 → 非 owner 不可见", () => {
        const profile = mockProfile({
            user_id: "u-1",
            profile_public: true,
            show_articles_on_profile: false,
        });
        expect(checkModuleVisible(profile, "articles", "other-user")).toBe(
            false,
        );
    });

    it("模块关闭 → owner 可见", () => {
        const profile = mockProfile({
            user_id: "u-1",
            profile_public: true,
            show_articles_on_profile: false,
        });
        expect(checkModuleVisible(profile, "articles", "u-1")).toBe(true);
    });

    it("profile 私密但模块开启 → 模块级仍返回 true（profile 级由 checkProfileVisible 处理）", () => {
        const profile = mockProfile({
            user_id: "u-1",
            profile_public: false,
            show_articles_on_profile: true,
        });
        // checkModuleVisible 仅检查模块级开关，不检查 profile_public
        expect(checkModuleVisible(profile, "articles", "other-user")).toBe(
            true,
        );
    });

    it("各模块正确映射", () => {
        const profile = mockProfile({
            profile_public: true,
            show_diaries_on_profile: true,
            show_bangumi_on_profile: true,
            show_albums_on_profile: true,
            show_comments_on_profile: true,
        });
        expect(checkModuleVisible(profile, "diaries", null)).toBe(true);
        expect(checkModuleVisible(profile, "bangumi", null)).toBe(true);
        expect(checkModuleVisible(profile, "albums", null)).toBe(true);
        expect(checkModuleVisible(profile, "comments", null)).toBe(true);
    });
});

// ── updateProfile ──

describe("updateProfile", () => {
    it("正常更新", async () => {
        const updated = mockProfile({ display_name: "New Name" });
        mockedRepo.updateProfile.mockResolvedValue(updated);

        const result = await updateProfile(
            "profile-1",
            { display_name: "New Name" },
            "user-1",
        );

        expect(result.display_name).toBe("New Name");
        expect(mockedRepo.updateProfile).toHaveBeenCalledWith(
            "profile-1",
            { display_name: "New Name" },
            "user-1",
        );
    });
});

// ── ensureUsernameAvailable ──

describe("ensureUsernameAvailable", () => {
    it("可用 → 不抛出", async () => {
        mockedRepo.isUsernameAvailable.mockResolvedValue(true);

        await expect(
            ensureUsernameAvailable("available-name"),
        ).resolves.toBeUndefined();
    });

    it("已存在 → 抛出 conflict", async () => {
        mockedRepo.isUsernameAvailable.mockResolvedValue(false);

        await expect(ensureUsernameAvailable("taken-name")).rejects.toThrow(
            AppError,
        );

        try {
            await ensureUsernameAvailable("taken-name");
        } catch (error) {
            expect((error as AppError).code).toBe("USERNAME_EXISTS");
            expect((error as AppError).status).toBe(409);
        }
    });

    it("传递 excludeProfileId", async () => {
        mockedRepo.isUsernameAvailable.mockResolvedValue(true);

        await ensureUsernameAvailable("name", "profile-1");

        expect(mockedRepo.isUsernameAvailable).toHaveBeenCalledWith(
            "name",
            "profile-1",
        );
    });
});
