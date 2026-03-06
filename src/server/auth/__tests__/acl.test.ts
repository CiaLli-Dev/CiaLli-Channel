import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile, mockSessionUser } from "@/__tests__/helpers/mock-data";
import {
    DIRECTUS_POLICY_NAME,
    DIRECTUS_ROLE_NAME,
} from "@/server/auth/directus-access";

vi.mock("@/server/directus/client", () => ({
    createOne: vi.fn(),
    readMany: vi.fn(),
    updateOne: vi.fn(),
}));

import { readMany } from "@/server/directus/client";
import { getAppAccessContext } from "@/server/auth/acl";

const mockedReadMany = vi.mocked(readMany);

function setupProfile(): void {
    mockedReadMany.mockImplementation(async (collection) => {
        if (collection === "app_user_profiles") {
            return [mockProfile({ user_id: "user-1" })] as never;
        }
        return [] as never;
    });
}

describe("getAppAccessContext 原生 Directus 权限映射", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupProfile();
    });

    it("Site Admin 角色应授予管理员权限", async () => {
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                roleName: DIRECTUS_ROLE_NAME.siteAdmin,
            }),
        );

        expect(access.permissions.app_role).toBe("admin");
        expect(access.isSiteAdmin).toBe(true);
        expect(access.isAdmin).toBe(true);
    });

    it("平台管理员应自动具备站点管理员权限", async () => {
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                roleName: DIRECTUS_ROLE_NAME.administrator,
                isSystemAdmin: true,
            }),
        );

        expect(access.permissions.app_role).toBe("admin");
        expect(access.isPlatformAdmin).toBe(true);
        expect(access.isAdmin).toBe(true);
    });

    it("Member 角色按策略映射能力", async () => {
        const access = await getAppAccessContext(
            mockSessionUser({
                id: "user-1",
                roleName: DIRECTUS_ROLE_NAME.member,
                policyNames: [DIRECTUS_POLICY_NAME.publishArticles],
            }),
        );

        expect(access.permissions.app_role).toBe("member");
        expect(access.permissions.can_publish_articles).toBe(true);
        expect(access.permissions.can_manage_diaries).toBe(false);
        expect(access.isAdmin).toBe(false);
    });
});
