import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/directus/client", () => ({
    updateOne: vi.fn(),
    updateDirectusUser: vi.fn(),
}));

vi.mock("@/server/auth/acl", () => ({
    updateProfileUsername: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    invalidateAuthorCache: vi.fn(),
}));

vi.mock("@/server/api/v1/public-data", () => ({
    invalidateOfficialSidebarCache: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
}));

import { updateDirectusUser, updateOne } from "@/server/directus/client";
import { handleMeProfile } from "@/server/api/v1/me/profile";

const mockedUpdateDirectusUser = vi.mocked(updateDirectusUser);
const mockedUpdateOne = vi.mocked(updateOne);

describe("/me/profile bangumi fields", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET returns bangumi_access_token_set only", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                bangumi_access_token_encrypted: "v1:encrypted",
            },
        });

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/me/profile",
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            ok: boolean;
            profile: Record<string, unknown>;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.profile.bangumi_access_token_set).toBe(true);
        expect("bangumi_access_token_encrypted" in body.profile).toBe(false);
    });

    it("PATCH accepts write-only bangumi_access_token and stores encrypted value", async () => {
        const access = createMemberAccess();
        mockedUpdateOne.mockResolvedValue({
            ...access.profile,
            bangumi_access_token_encrypted: "v1:new-encrypted",
        });

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                bangumi_access_token: "bgm_pat_new_token",
                bangumi_username: "914320",
                bangumi_include_private: true,
                show_bangumi_on_profile: true,
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        const payload = mockedUpdateOne.mock.calls[0]?.[2] as Record<
            string,
            unknown
        >;

        expect(typeof payload.bangumi_access_token_encrypted).toBe("string");
        expect(String(payload.bangumi_access_token_encrypted)).not.toContain(
            "bgm_pat_new_token",
        );
        expect(
            (payload as { bangumi_access_token?: unknown })
                .bangumi_access_token,
        ).toBeUndefined();
    });

    it("PATCH clears token when bangumi_access_token is null", async () => {
        const access = createMemberAccess();
        mockedUpdateOne.mockResolvedValue({
            ...access.profile,
            bangumi_access_token_encrypted: null,
        });

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                bangumi_access_token: null,
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        const payload = mockedUpdateOne.mock.calls[0]?.[2] as Record<
            string,
            unknown
        >;
        expect(payload.bangumi_access_token_encrypted).toBeNull();
    });

    it("PATCH writes bio and avatar_file to directus_users", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                bio: "旧简介",
                avatar_file: "old-avatar-id",
            },
        });
        mockedUpdateOne.mockResolvedValue({
            ...access.profile,
            profile_public: false,
        });

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                bio: "新简介",
                avatar_file: "new-avatar-id",
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateDirectusUser).toHaveBeenCalledWith("user-1", {
            description: "新简介",
            avatar: "new-avatar-id",
        });
    });

    it("PATCH 更新基础资料时不会隐式清空 social_links", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                social_links: [
                    {
                        platform: "github",
                        url: "https://github.com/test",
                        enabled: true,
                    },
                ],
            },
        });
        mockedUpdateOne.mockResolvedValue({
            ...access.profile,
            display_name: "新昵称",
        });

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                display_name: "新昵称",
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_user_profiles",
            access.profile.id,
            { display_name: "新昵称" },
        );
    });

    it("PATCH clears avatar on directus_users when avatar_file is null", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                avatar_file: "old-avatar-id",
            },
        });
        mockedUpdateOne.mockResolvedValue(access.profile);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                avatar_file: null,
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateDirectusUser).toHaveBeenCalledWith("user-1", {
            avatar: null,
        });
    });

    it("PATCH rejects non-digit bangumi id", async () => {
        const access = createMemberAccess();

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                bangumi_username: "alice",
            },
        });

        await expect(
            handleMeProfile(ctx as unknown as APIContext, access),
        ).rejects.toMatchObject({
            status: 400,
        });
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });
});
