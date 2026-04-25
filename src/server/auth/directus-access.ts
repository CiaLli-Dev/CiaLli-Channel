import type { AppPermissionKey, AppPermissions, AppRole } from "@/types/app";
import type { AppUser } from "@/types/app";

export const DIRECTUS_ROLE_NAME = {
    member: "Member",
    siteAdmin: "Site Admin",
    administrator: "Administrator",
} as const;

export const DIRECTUS_POLICY_NAME = {
    memberBase: "Member",
    publishArticles: "Publish Articles",
    commentArticles: "Comment Articles",
    manageDiaries: "Manage Diaries",
    commentDiaries: "Comment Diaries",
    manageAlbums: "Manage Albums",
    uploadFiles: "Upload Files",
    siteAdmin: "Site Admin",
} as const;

const POLICY_NAME_BY_PERMISSION: Record<AppPermissionKey, string> = {
    can_publish_articles: DIRECTUS_POLICY_NAME.publishArticles,
    can_comment_articles: DIRECTUS_POLICY_NAME.commentArticles,
    can_manage_diaries: DIRECTUS_POLICY_NAME.manageDiaries,
    can_comment_diaries: DIRECTUS_POLICY_NAME.commentDiaries,
    can_manage_albums: DIRECTUS_POLICY_NAME.manageAlbums,
    can_upload_files: DIRECTUS_POLICY_NAME.uploadFiles,
};

export function isSiteAdminRoleName(
    roleName: string | null | undefined,
): boolean {
    return String(roleName || "").trim() === DIRECTUS_ROLE_NAME.siteAdmin;
}

export function extractDirectusRoleName(
    role: AppUser["role"] | undefined | null,
): string | null {
    if (!role) {
        return null;
    }
    if (typeof role === "string") {
        return role.trim() || null;
    }
    const roleName = String(role.name ?? "").trim();
    if (roleName) {
        return roleName;
    }
    const roleId = String(role.id ?? "").trim();
    return roleId || null;
}

export function extractDirectusPolicyIds(
    policies: AppUser["policies"] | undefined | null,
): string[] {
    if (!Array.isArray(policies)) {
        return [];
    }
    return policies
        .map((entry) => {
            if (typeof entry === "string") {
                return entry.trim();
            }
            if (entry && typeof entry === "object") {
                const policy = entry.policy;
                if (typeof policy === "string") {
                    return policy.trim() || String(entry.id ?? "").trim();
                }
                if (policy && typeof policy === "object") {
                    const policyId = String(policy.id ?? "").trim();
                    if (policyId) {
                        return policyId;
                    }
                }
                return String(entry.id ?? "").trim();
            }
            return "";
        })
        .filter(Boolean);
}

export function resolvePolicyNames(
    policyIds: readonly string[],
    policyNameMap: ReadonlyMap<string, string>,
): string[] {
    return policyIds
        .map((policyId) => policyNameMap.get(policyId) || "")
        .filter(Boolean);
}

export function resolveAppRole(params: {
    roleName?: string | null;
    isPlatformAdmin: boolean;
}): AppRole {
    if (
        params.isPlatformAdmin ||
        isPlatformAdministratorRoleName(params.roleName) ||
        isSiteAdminRoleName(params.roleName)
    ) {
        return "admin";
    }
    return "member";
}

export function isPlatformAdministratorRoleName(
    roleName: string | null | undefined,
): boolean {
    return String(roleName || "").trim() === DIRECTUS_ROLE_NAME.administrator;
}

export function buildPermissionsFromDirectus(params: {
    roleName?: string | null;
    policyNames: Iterable<string>;
    isPlatformAdmin: boolean;
}): AppPermissions {
    const appRole = resolveAppRole(params);
    if (appRole === "admin") {
        return {
            app_role: "admin",
            can_publish_articles: true,
            can_comment_articles: true,
            can_manage_diaries: true,
            can_comment_diaries: true,
            can_manage_albums: true,
            can_upload_files: true,
        };
    }

    const policyNameSet = new Set(
        Array.from(params.policyNames, (name) =>
            String(name || "").trim(),
        ).filter(Boolean),
    );

    return {
        app_role: "member",
        can_publish_articles: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_publish_articles,
        ),
        can_comment_articles: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_comment_articles,
        ),
        can_manage_diaries: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_manage_diaries,
        ),
        can_comment_diaries: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_comment_diaries,
        ),
        can_manage_albums: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_manage_albums,
        ),
        can_upload_files: policyNameSet.has(
            POLICY_NAME_BY_PERMISSION.can_upload_files,
        ),
    };
}
