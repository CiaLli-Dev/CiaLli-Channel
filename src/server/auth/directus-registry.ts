import { cacheManager } from "@/server/cache/manager";
import {
    listDirectusPolicies,
    listDirectusRoles,
    runWithDirectusServiceAccess,
    type DirectusPolicyRecord,
    type DirectusRoleRecord,
} from "@/server/directus/client";

const REGISTRY_CACHE_KEY = "directus-access-registry:v1";

export type DirectusAccessRegistry = {
    roleIdByName: Map<string, string>;
    roleNameById: Map<string, string>;
    policyIdByName: Map<string, string>;
    policyNameById: Map<string, string>;
    roles: DirectusRoleRecord[];
    policies: DirectusPolicyRecord[];
};

function buildRegistry(params: {
    roles: DirectusRoleRecord[];
    policies: DirectusPolicyRecord[];
}): DirectusAccessRegistry {
    const roleIdByName = new Map<string, string>();
    const roleNameById = new Map<string, string>();
    for (const role of params.roles) {
        const roleId = String(role.id || "").trim();
        const roleName = String(role.name || "").trim();
        if (roleId && roleName) {
            roleIdByName.set(roleName, roleId);
            roleNameById.set(roleId, roleName);
        }
    }

    const policyIdByName = new Map<string, string>();
    const policyNameById = new Map<string, string>();
    for (const policy of params.policies) {
        const policyId = String(policy.id || "").trim();
        const policyName = String(policy.name || "").trim();
        if (policyId && policyName) {
            policyIdByName.set(policyName, policyId);
            policyNameById.set(policyId, policyName);
        }
    }

    return {
        roleIdByName,
        roleNameById,
        policyIdByName,
        policyNameById,
        roles: params.roles,
        policies: params.policies,
    };
}

function serializeRegistry(
    registry: DirectusAccessRegistry,
): Record<string, unknown> {
    return {
        roles: registry.roles,
        policies: registry.policies,
    };
}

function deserializeRegistry(
    raw: Record<string, unknown>,
): DirectusAccessRegistry | null {
    const roles = Array.isArray(raw.roles)
        ? (raw.roles as DirectusRoleRecord[])
        : null;
    const policies = Array.isArray(raw.policies)
        ? (raw.policies as DirectusPolicyRecord[])
        : null;
    if (!roles || !policies) {
        return null;
    }
    return buildRegistry({ roles, policies });
}

export async function loadDirectusAccessRegistry(): Promise<DirectusAccessRegistry> {
    const cached = await cacheManager.get<Record<string, unknown>>(
        "session-user",
        REGISTRY_CACHE_KEY,
    );
    if (cached) {
        const registry = deserializeRegistry(cached);
        if (registry) {
            return registry;
        }
    }

    const [roles, policies] = await runWithDirectusServiceAccess(
        async () =>
            await Promise.all([listDirectusRoles(), listDirectusPolicies()]),
    );
    const registry = buildRegistry({ roles, policies });
    void cacheManager.set(
        "session-user",
        REGISTRY_CACHE_KEY,
        serializeRegistry(registry),
    );
    return registry;
}

export function invalidateDirectusAccessRegistry(): void {
    void cacheManager.invalidate("session-user", REGISTRY_CACHE_KEY);
}
