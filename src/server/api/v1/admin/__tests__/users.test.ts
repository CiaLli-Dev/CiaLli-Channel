import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile, mockSessionUser } from "@/__tests__/helpers/mock-data";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { AppUser } from "@/types/app";
import { DIRECTUS_ROLE_NAME } from "@/server/auth/directus-access";

vi.mock("@/server/api/v1/shared", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("@/server/api/v1/shared")>();
    return {
        ...actual,
        requireAdmin: vi.fn(),
    };
});

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    deleteDirectusUser: vi.fn(),
    deleteOne: vi.fn(),
    listDirectusUsers: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    runWithDirectusUserAccess: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
    syncDirectusUserPolicies: vi.fn().mockResolvedValue(undefined),
    updateDirectusFileMetadata: vi.fn(),
    updateDirectusUser: vi.fn(),
    updateOne: vi.fn(),
}));

vi.mock("@/server/auth/directus-registry", () => ({
    invalidateDirectusAccessRegistry: vi.fn(),
    loadDirectusAccessRegistry: vi.fn(),
}));

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        invalidateByDomain: vi.fn(),
    },
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    invalidateAuthorCache: vi.fn(),
}));

vi.mock("@/server/api/v1/public-data", () => ({
    invalidateOfficialSidebarCache: vi.fn(),
}));

vi.mock("@/server/api/v1/shared/file-cleanup", () => ({
    cleanupOwnedOrphanDirectusFiles: vi.fn().mockResolvedValue([]),
    collectReferencedDirectusFileIds: vi.fn().mockResolvedValue([]),
    collectUserOwnedFileIds: vi.fn().mockResolvedValue([]),
    normalizeDirectusFileId: vi.fn((value: unknown) =>
        typeof value === "string" ? value : null,
    ),
}));

vi.mock("@/server/api/v1/admin/users-helpers", () => ({
    clearBlockingUserReferences: vi.fn().mockResolvedValue(undefined),
    loadReferencedFilesByUser: vi.fn().mockResolvedValue([]),
    nullifyReferencedFileOwnership: vi.fn().mockResolvedValue(undefined),
    nullifyRegistrationRequestAvatars: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin } from "@/server/api/v1/shared";
import { loadDirectusAccessRegistry } from "@/server/auth/directus-registry";
import { readMany, readOneById, updateOne } from "@/server/directus/client";
import { handleAdminUsers } from "@/server/api/v1/admin/users";

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedLoadDirectusAccessRegistry = vi.mocked(loadDirectusAccessRegistry);
const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);

function createDirectusUser(overrides: Partial<AppUser> = {}): AppUser {
    return {
        id: "user-2",
        email: "user-2@example.com",
        first_name: "User",
        last_name: "Two",
        description: null,
        avatar: null,
        role: {
            id: "role-member",
            name: DIRECTUS_ROLE_NAME.member,
        },
        policies: [],
        ...overrides,
    };
}

describe("PATCH /admin/users/:id", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedRequireAdmin.mockResolvedValue({
            access: {
                isAdmin: true,
                user: mockSessionUser({ id: "admin-1" }),
            },
            accessToken: "admin-access-token",
        } as never);
        mockedLoadDirectusAccessRegistry.mockResolvedValue({
            policyNameById: new Map<string, string>(),
            policyIdByName: new Map<string, string>(),
            roleIdByName: new Map<string, string>(),
        } as never);
    });

    it("仅更新 display_name 时不会隐式清空 social_links", async () => {
        const actingAdmin = createDirectusUser({
            id: "admin-1",
            email: "admin@example.com",
            role: {
                id: "role-site-admin",
                name: DIRECTUS_ROLE_NAME.siteAdmin,
            },
        });
        const targetUser = createDirectusUser();
        const profile = mockProfile({
            id: "profile-2",
            user_id: "user-2",
            social_links: [
                {
                    platform: "github",
                    url: "https://github.com/user-2",
                    enabled: true,
                },
            ],
        });
        const updatedProfile = {
            ...profile,
            display_name: "Updated User",
        };

        mockedReadOneById
            .mockResolvedValueOnce(actingAdmin as never)
            .mockResolvedValueOnce(targetUser as never)
            .mockResolvedValueOnce(targetUser as never);
        mockedReadMany.mockResolvedValue([profile] as never);
        mockedUpdateOne.mockResolvedValue(updatedProfile as never);

        const ctx = createMockAPIContext({
            method: "PATCH",
            url: "http://localhost:4321/api/v1/admin/users/user-2",
            params: {
                segments: "admin/users/user-2",
            },
            body: {
                display_name: "Updated User",
            },
        });

        const response = await handleAdminUsers(ctx as unknown as APIContext, [
            "users",
            "user-2",
        ]);

        expect(response.status).toBe(200);
        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_user_profiles",
            "profile-2",
            { display_name: "Updated User" },
        );

        const body = await parseResponseJson<{
            ok: boolean;
            profile: { display_name: string };
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.profile.display_name).toBe("Updated User");
    });
});
