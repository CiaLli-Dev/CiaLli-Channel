import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    mockPermissions,
    mockProfile,
    mockSessionUser,
} from "@/__tests__/helpers/mock-data";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    readOneById: vi.fn(),
    updateOne: vi.fn(),
}));

import { readMany, readOneById, updateOne } from "@/server/directus/client";
import { getAppAccessContext } from "@/server/auth/acl";

const mockedReadMany = vi.mocked(readMany);
const mockedReadOneById = vi.mocked(readOneById);
const mockedUpdateOne = vi.mocked(updateOne);

function setupIdentity(appRole: "admin" | "member"): void {
    mockedReadMany.mockImplementation(async (collection) => {
        if (collection === "app_user_profiles") {
            return [mockProfile({ user_id: "user-1" })] as never;
        }
        if (collection === "app_user_permissions") {
            return [
                mockPermissions({
                    id: "perm-1",
                    user_id: "user-1",
                    app_role: appRole,
                }),
            ] as never;
        }
        return [] as never;
    });
    mockedReadOneById.mockResolvedValue({
        id: "user-1",
        email: "user-1@example.com",
        first_name: null,
        last_name: null,
        avatar: null,
        role: null,
    } as never);
}

describe("getAppAccessContext 双因子管理员", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUpdateOne.mockResolvedValue(
            mockPermissions({
                id: "perm-1",
                user_id: "user-1",
                app_role: "admin",
            }) as never,
        );
    });

    it("admin_access=false + app_role=admin 时不授予管理员权限", async () => {
        setupIdentity("admin");
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                isSystemAdmin: false,
            }),
        );

        expect(access.permissions.app_role).toBe("admin");
        expect(access.isAdmin).toBe(false);
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("admin_access=true + app_role=admin 时授予管理员权限", async () => {
        setupIdentity("admin");
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                isSystemAdmin: true,
            }),
        );

        expect(access.permissions.app_role).toBe("admin");
        expect(access.isAdmin).toBe(true);
        expect(mockedUpdateOne).not.toHaveBeenCalled();
    });

    it("admin_access=true + app_role=member 时自动同步为 admin", async () => {
        setupIdentity("member");
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                isSystemAdmin: true,
            }),
        );

        expect(mockedUpdateOne).toHaveBeenCalledWith(
            "app_user_permissions",
            "perm-1",
            {
                app_role: "admin",
            },
        );
        expect(access.permissions.app_role).toBe("admin");
        expect(access.isAdmin).toBe(true);
    });
});
