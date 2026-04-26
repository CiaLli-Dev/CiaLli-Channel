import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

import { createMemberAccess } from "@/__tests__/helpers/mock-access";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";

vi.mock("@/server/directus/client", () => ({
    readOneById: vi.fn(),
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
    normalizeDirectusFileId: vi.fn((value: unknown) => {
        const uuidPattern =
            /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
        if (typeof value === "string") {
            const match = value.trim().match(uuidPattern);
            return match?.[0].toLowerCase() || null;
        }
        if (value && typeof value === "object") {
            const record = value as { id?: unknown };
            return typeof record.id === "string"
                ? record.id.toLowerCase()
                : null;
        }
        return null;
    }),
}));

vi.mock("@/server/api/v1/me/_helpers", () => ({
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    syncManagedFileBinding: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
}));

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/auth/session", () => ({
    getSessionAccessToken: vi.fn(() => "access-token-1"),
    invalidateSessionUserCache: vi.fn(),
}));

import {
    readOneById,
    updateDirectusUser,
    updateOne,
} from "@/server/directus/client";
import { invalidateSessionUserCache } from "@/server/auth/session";
import {
    bindFileOwnerToUser,
    syncManagedFileBinding,
} from "@/server/api/v1/me/_helpers";
import { handleMeProfile } from "@/server/api/v1/me/profile";

const mockedUpdateDirectusUser = vi.mocked(updateDirectusUser);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedReadOneById = vi.mocked(readOneById);
const mockedInvalidateSessionUserCache = vi.mocked(invalidateSessionUserCache);
const mockedBindFileOwnerToUser = vi.mocked(bindFileOwnerToUser);
const mockedSyncManagedFileBinding = vi.mocked(syncManagedFileBinding);

const OLD_AVATAR_ID = "11111111-1111-4111-8111-111111111111";
const NEW_AVATAR_ID = "22222222-2222-4222-8222-222222222222";

function makeAvatarFile(id = NEW_AVATAR_ID): Record<string, unknown> {
    return {
        id,
        app_lifecycle: "temporary",
        app_owner_user_id: "user-1",
        app_upload_purpose: "avatar",
        uploaded_by: "user-1",
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("/me/profile bangumi fields", () => {
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
});

describe("/me/profile avatar and base fields", () => {
    it("PATCH writes bio and avatar_file to directus_users", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                bio: "旧简介",
                avatar_file: OLD_AVATAR_ID,
            },
        });
        mockedReadOneById
            .mockResolvedValueOnce(makeAvatarFile() as never)
            .mockResolvedValueOnce({
                id: "user-1",
                description: "新简介",
                avatar: NEW_AVATAR_ID,
            } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                bio: "新简介",
                avatar_file: NEW_AVATAR_ID,
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateDirectusUser).toHaveBeenCalledWith("user-1", {
            description: "新简介",
            avatar: NEW_AVATAR_ID,
        });
        expect(mockedSyncManagedFileBinding).toHaveBeenCalledWith(
            expect.objectContaining({
                previousFileValue: OLD_AVATAR_ID,
                nextFileValue: NEW_AVATAR_ID,
                strict: true,
            }),
        );
        await expect(
            parseResponseJson<{ profile: Record<string, unknown> }>(response),
        ).resolves.toMatchObject({
            profile: {
                bio: "新简介",
                avatar_file: NEW_AVATAR_ID,
            },
        });
        expect(mockedInvalidateSessionUserCache).toHaveBeenCalledWith(
            "access-token-1",
        );
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
                avatar_file: OLD_AVATAR_ID,
            },
        });
        mockedReadOneById.mockResolvedValueOnce({
            id: "user-1",
            description: null,
            avatar: null,
        } as never);

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
        await expect(
            parseResponseJson<{ profile: Record<string, unknown> }>(response),
        ).resolves.toMatchObject({
            profile: {
                avatar_file: null,
            },
        });
    });

    it("PATCH rejects forged avatar_file before Directus user update", async () => {
        const access = createMemberAccess();
        mockedReadOneById.mockResolvedValueOnce(null);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                avatar_file: NEW_AVATAR_ID,
            },
        });

        await expect(
            handleMeProfile(ctx as unknown as APIContext, access),
        ).rejects.toMatchObject({
            code: "AVATAR_FILE_INVALID",
            status: 400,
        });
        expect(mockedUpdateDirectusUser).not.toHaveBeenCalled();
        expect(mockedSyncManagedFileBinding).not.toHaveBeenCalled();
    });

    it("PATCH fails when Directus reports success but avatar was not persisted", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                avatar_file: OLD_AVATAR_ID,
            },
        });
        mockedReadOneById
            .mockResolvedValueOnce(makeAvatarFile() as never)
            .mockResolvedValueOnce({
                id: "user-1",
                description: null,
                avatar: null,
            } as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/me/profile",
            body: {
                avatar_file: NEW_AVATAR_ID,
            },
        });

        await expect(
            handleMeProfile(ctx as unknown as APIContext, access),
        ).rejects.toMatchObject({
            code: "AVATAR_SAVE_FAILED",
            status: 500,
        });
        expect(mockedUpdateDirectusUser).toHaveBeenNthCalledWith(1, "user-1", {
            avatar: NEW_AVATAR_ID,
        });
        expect(mockedUpdateDirectusUser).toHaveBeenNthCalledWith(2, "user-1", {
            avatar: OLD_AVATAR_ID,
        });
    });

    it("PATCH keeps avatar_file when only profile_public changes", async () => {
        const access = createMemberAccess({
            profile: {
                ...createMemberAccess().profile,
                avatar_file: OLD_AVATAR_ID,
                profile_public: true,
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
                profile_public: false,
            },
        });

        const response = await handleMeProfile(
            ctx as unknown as APIContext,
            access,
        );

        expect(response.status).toBe(200);
        expect(mockedUpdateDirectusUser).not.toHaveBeenCalled();
        expect(mockedBindFileOwnerToUser).toHaveBeenCalledWith(
            OLD_AVATAR_ID,
            "user-1",
            undefined,
            "private",
            expect.objectContaining({
                ownerCollection: "directus_users",
                ownerField: "avatar",
            }),
        );
        await expect(
            parseResponseJson<{ profile: Record<string, unknown> }>(response),
        ).resolves.toMatchObject({
            profile: {
                avatar_file: OLD_AVATAR_ID,
                profile_public: false,
            },
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
