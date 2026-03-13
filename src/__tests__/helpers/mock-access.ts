/**
 * AppAccess mock 工厂
 *
 * 构造 ACL 上下文对象（user + profile + permissions + isAdmin）。
 */

import type { AppAccessContext } from "@/server/auth/acl";

import {
    mockProfileView,
    mockPermissions,
    mockSessionUser,
    mockAdminSessionUser,
} from "./mock-data";

export function createMemberAccess(
    overrides: Partial<AppAccessContext> = {},
): AppAccessContext {
    return {
        user: mockSessionUser(),
        profile: mockProfileView(),
        permissions: mockPermissions(),
        isAdmin: false,
        isSiteAdmin: false,
        isPlatformAdmin: false,
        ...overrides,
    };
}

export function createAdminAccess(
    overrides: Partial<AppAccessContext> = {},
): AppAccessContext {
    return {
        user: mockAdminSessionUser(),
        profile: mockProfileView({
            id: "admin-profile-1",
            user_id: "admin-1",
            username: "admin",
            display_name: "Admin",
        }),
        permissions: mockPermissions({
            app_role: "admin",
        }),
        isAdmin: true,
        isSiteAdmin: true,
        isPlatformAdmin: false,
        ...overrides,
    };
}
