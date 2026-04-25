import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile, mockSessionUser } from "@/__tests__/helpers/mock-data";
import {
    createMockAPIContext,
    parseResponseJson,
} from "@/__tests__/helpers/mock-api-context";
import type { AppUser } from "@/types/app";
import { DIRECTUS_ROLE_NAME } from "@/server/auth/directus-access";

vi.mock("@/server/api/v1/shared/auth", () => ({
    requireAdmin: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    deleteDirectusUser: vi.fn(),
    deleteOne: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/server/repositories/directus/scope", () => ({
    withServiceRepositoryContext: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
    withUserRepositoryContext: vi.fn(
        async (_token: string, task: () => Promise<unknown>) => await task(),
    ),
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

vi.mock("@/server/api/v1/me/_helpers", () => ({
    deleteFileReferencesForOwner: vi.fn().mockResolvedValue(0),
    bindFileOwnerToUser: vi.fn().mockResolvedValue(undefined),
    detachManagedFiles: vi.fn().mockResolvedValue([]),
    syncManagedFileBinding: vi.fn().mockResolvedValue({
        attachedFileIds: [],
        detachedFileIds: [],
        nextFileIds: [],
    }),
}));

vi.mock("@/server/files/resource-lifecycle", () => ({
    resourceLifecycle: {
        releaseOwnerResources: vi.fn().mockResolvedValue({
            jobId: "release-job-1",
            status: "pending",
            candidateFileIds: [],
            deletedReferences: 0,
        }),
    },
}));

vi.mock("@/server/application/shared/search-index", () => ({
    searchIndex: {
        remove: vi.fn().mockResolvedValue(undefined),
    },
}));

import { requireAdmin } from "@/server/api/v1/shared/auth";
import { loadDirectusAccessRegistry } from "@/server/auth/directus-registry";
import {
    deleteDirectusUser,
    listDirectusUsers,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { handleAdminUsers } from "@/server/api/v1/admin/users";
import { normalizeDirectusFileId } from "@/server/api/v1/shared/file-cleanup";
import { syncManagedFileBinding } from "@/server/api/v1/me/_helpers";
import { resourceLifecycle } from "@/server/files/resource-lifecycle";
import {
    clearBlockingUserReferences,
    loadReferencedFilesByUser,
    nullifyReferencedFileOwnership,
} from "@/server/api/v1/admin/users-helpers";

const mockedRequireAdmin = vi.mocked(requireAdmin);
const mockedLoadDirectusAccessRegistry = vi.mocked(loadDirectusAccessRegistry);
const mockedDeleteDirectusUser = vi.mocked(deleteDirectusUser);
const mockedListDirectusUsers = vi.mocked(listDirectusUsers);
const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);
const mockedClearBlockingUserReferences = vi.mocked(
    clearBlockingUserReferences,
);
const mockedLoadReferencedFilesByUser = vi.mocked(loadReferencedFilesByUser);
const mockedNullifyReferencedFileOwnership = vi.mocked(
    nullifyReferencedFileOwnership,
);
const mockedNormalizeDirectusFileId = vi.mocked(normalizeDirectusFileId);
const mockedSyncManagedFileBinding = vi.mocked(syncManagedFileBinding);
const mockedReleaseOwnerResources = vi.mocked(
    resourceLifecycle.releaseOwnerResources,
);

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

describe("GET /admin/users", () => {
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

    it("默认列表请求返回成功", async () => {
        mockedReadOneById.mockResolvedValueOnce(
            createDirectusUser({
                id: "admin-1",
                role: {
                    id: "role-site-admin",
                    name: DIRECTUS_ROLE_NAME.siteAdmin,
                },
            }) as never,
        );
        mockedListDirectusUsers.mockResolvedValueOnce([
            createDirectusUser({
                id: "user-a",
                email: "a@example.com",
            }),
        ] as never);
        mockedReadMany.mockResolvedValueOnce([
            mockProfile({
                id: "profile-a",
                user_id: "user-a",
                username: "alpha",
            }),
        ] as never);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/admin/users?page=1&limit=20",
            params: {
                segments: "admin/users",
            },
        });

        const response = await handleAdminUsers(ctx as unknown as APIContext, [
            "users",
        ]);

        expect(response.status).toBe(200);
        expect(mockedListDirectusUsers).toHaveBeenCalledWith({
            limit: 20,
            offset: 0,
            search: undefined,
            sort: {
                field: "email",
                order: "asc",
            },
        });
        const body = await parseResponseJson<{
            ok: boolean;
            items: Array<{
                user: { id: string };
                profile: { username: string };
            }>;
            page: number;
            limit: number;
        }>(response);
        expect(body.ok).toBe(true);
        expect(body.page).toBe(1);
        expect(body.limit).toBe(20);
        expect(body.items).toHaveLength(1);
        expect(body.items[0]?.user.id).toBe("user-a");
        expect(body.items[0]?.profile.username).toBe("alpha");
    });

    it("username 排序在缺失与空字符串场景下保持稳定", async () => {
        mockedReadOneById.mockResolvedValueOnce(
            createDirectusUser({
                id: "admin-1",
                role: {
                    id: "role-site-admin",
                    name: DIRECTUS_ROLE_NAME.siteAdmin,
                },
            }) as never,
        );
        mockedListDirectusUsers.mockResolvedValueOnce([
            createDirectusUser({
                id: "user-a",
                email: "z@example.com",
            }),
            createDirectusUser({
                id: "user-b",
                email: "b@example.com",
            }),
            createDirectusUser({
                id: "user-c",
                email: "c@example.com",
            }),
            createDirectusUser({
                id: "user-d",
                email: "d@example.com",
            }),
        ] as never);
        mockedReadMany.mockResolvedValueOnce([
            mockProfile({
                id: "profile-a",
                user_id: "user-a",
                username: "",
            }),
            mockProfile({
                id: "profile-b",
                user_id: "user-b",
                username: "beta",
            }),
            mockProfile({
                id: "profile-c",
                user_id: "user-c",
                username: "alpha",
            }),
        ] as never);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/admin/users?sort_by=username&sort_order=asc",
            params: {
                segments: "admin/users",
            },
        });

        const response = await handleAdminUsers(ctx as unknown as APIContext, [
            "users",
        ]);

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            items: Array<{ user: { id: string } }>;
        }>(response);
        expect(body.items.map((item) => item.user.id)).toEqual([
            "user-c",
            "user-b",
            "user-a",
            "user-d",
        ]);
    });

    it("role 排序对平台管理员/站点管理员/普通成员稳定", async () => {
        mockedLoadDirectusAccessRegistry.mockResolvedValue({
            policyNameById: new Map<string, string>(),
            policyIdByName: new Map<string, string>(),
            roleIdByName: new Map<string, string>(),
        } as never);
        mockedReadOneById.mockResolvedValueOnce(
            createDirectusUser({
                id: "admin-1",
                role: {
                    id: "role-site-admin",
                    name: DIRECTUS_ROLE_NAME.siteAdmin,
                },
            }) as never,
        );
        mockedListDirectusUsers.mockResolvedValueOnce([
            createDirectusUser({
                id: "member-1",
                email: "member-1@example.com",
                role: {
                    id: "role-member",
                    name: DIRECTUS_ROLE_NAME.member,
                },
            }),
            createDirectusUser({
                id: "platform-admin",
                email: "platform-admin@example.com",
                role: {
                    id: "role-admin",
                    name: DIRECTUS_ROLE_NAME.administrator,
                },
            }),
            createDirectusUser({
                id: "site-admin",
                email: "site-admin@example.com",
                role: {
                    id: "role-site-admin",
                    name: DIRECTUS_ROLE_NAME.siteAdmin,
                },
            }),
            createDirectusUser({
                id: "member-2",
                email: "member-2@example.com",
                role: {
                    id: "role-member",
                    name: DIRECTUS_ROLE_NAME.member,
                },
            }),
        ] as never);
        mockedReadMany.mockResolvedValueOnce([] as never);

        const ctx = createMockAPIContext({
            method: "GET",
            url: "http://localhost:4321/api/v1/admin/users?sort_by=role&sort_order=asc",
            params: {
                segments: "admin/users",
            },
        });

        const response = await handleAdminUsers(ctx as unknown as APIContext, [
            "users",
        ]);

        expect(response.status).toBe(200);
        const body = await parseResponseJson<{
            items: Array<{ user: { id: string } }>;
        }>(response);
        expect(body.items.map((item) => item.user.id)).toEqual([
            "platform-admin",
            "site-admin",
            "member-1",
            "member-2",
        ]);
    });
});

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

describe("DELETE /admin/users/:id", () => {
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
        mockedNormalizeDirectusFileId.mockImplementation((value: unknown) =>
            typeof value === "string" ? value : null,
        );
        mockedLoadReferencedFilesByUser.mockResolvedValue([
            {
                id: "file-referenced",
                uploaded_by: "user-2",
                modified_by: null,
                app_owner_user_id: "user-2",
            },
        ]);
    });

    it("先 detach 用户资料文件、清空文件归属与阻塞引用，再删除用户", async () => {
        const actingAdmin = createDirectusUser({
            id: "admin-1",
            email: "admin@example.com",
            role: {
                id: "role-site-admin",
                name: DIRECTUS_ROLE_NAME.siteAdmin,
            },
        });
        const targetUser = createDirectusUser({ avatar: "file-avatar" });

        mockedReadOneById
            .mockResolvedValueOnce(actingAdmin as never)
            .mockResolvedValueOnce(targetUser as never);
        mockedReadMany
            .mockResolvedValueOnce([
                { id: "profile-2", header_file: "file-header" },
            ] as never)
            .mockResolvedValueOnce([
                { id: "request-2", avatar_file: "file-referenced" },
            ] as never);

        const ctx = createMockAPIContext({
            method: "DELETE",
            url: "http://localhost:4321/api/v1/admin/users/user-2",
            params: {
                segments: "admin/users/user-2",
            },
        });

        const response = await handleAdminUsers(ctx as unknown as APIContext, [
            "users",
            "user-2",
        ]);

        expect(response.status).toBe(200);
        expect(mockedReadMany).toHaveBeenCalledWith("app_user_profiles", {
            filter: { user_id: { _eq: "user-2" } },
            limit: 10,
            fields: ["id", "header_file"],
        });
        expect(mockedReleaseOwnerResources).toHaveBeenCalledWith({
            ownerCollection: "app_user_profiles",
            ownerId: "profile-2",
        });
        expect(mockedSyncManagedFileBinding).toHaveBeenCalledWith({
            previousFileValue: "file-referenced",
            nextFileValue: null,
            userId: "user-2",
            visibility: "private",
            reference: {
                ownerCollection: "app_user_registration_requests",
                ownerId: "request-2",
                ownerField: "avatar_file",
                referenceKind: "structured_field",
            },
        });
        expect(mockedReleaseOwnerResources).toHaveBeenCalledWith({
            ownerCollection: "directus_users",
            ownerId: "user-2",
        });
        expect(mockedNullifyReferencedFileOwnership).toHaveBeenCalledWith(
            [
                {
                    id: "file-referenced",
                    uploaded_by: "user-2",
                    modified_by: null,
                    app_owner_user_id: "user-2",
                },
            ],
            "user-2",
        );
        expect(mockedClearBlockingUserReferences).toHaveBeenCalledWith(
            "user-2",
        );
        expect(mockedDeleteDirectusUser).toHaveBeenCalledWith("user-2");
        expect(
            mockedNullifyReferencedFileOwnership.mock.invocationCallOrder[0],
        ).toBeLessThan(
            mockedClearBlockingUserReferences.mock.invocationCallOrder[0],
        );
        expect(
            mockedClearBlockingUserReferences.mock.invocationCallOrder[0],
        ).toBeLessThan(mockedDeleteDirectusUser.mock.invocationCallOrder[0]);
        expect(
            mockedReleaseOwnerResources.mock.invocationCallOrder.at(-1) ?? 0,
        ).toBeLessThan(mockedDeleteDirectusUser.mock.invocationCallOrder[0]);
    });
});
