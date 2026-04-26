import { createHash } from "node:crypto";
import type { APIContext } from "astro";

import type { AppUser } from "@/types/app";
import { cacheManager } from "@/server/cache/manager";
import {
    extractDirectusPolicyIds,
    resolvePolicyNames,
} from "@/server/auth/directus-access";
import { loadDirectusAccessRegistry } from "@/server/auth/directus-registry";
import {
    cacheDistributedRefreshResult,
    getDistributedRefreshResult,
    tryAcquireDistributedRefreshLock,
    waitDistributedRefreshResult,
} from "@/server/auth/refresh-coordinator";
import {
    listDirectusUserPolicyAssignments,
    readOneById,
    runWithDirectusServiceAccess,
} from "@/server/directus/client";
import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
    DirectusAuthError,
    REMEMBER_COOKIE_NAME,
    buildDirectusAssetUrl,
    directusGetMe,
    directusRefresh,
    getCookieOptions,
    isSessionOnlyMode,
    resolveAccessTokenMaxAgeSeconds,
} from "@/server/directus-auth";

export type SessionUser = {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
    avatarFileId?: string;
    description?: string | null;
    roleId?: string;
    roleName?: string;
    policyIds: string[];
    policyNames: string[];
    isSystemAdmin: boolean;
};

type SessionUserCacheEntry = SessionUser;

type RefreshedTokens = Awaited<ReturnType<typeof directusRefresh>>;
type DirectusMe = Awaited<ReturnType<typeof directusGetMe>>;
type JwtPayload = {
    admin_access?: unknown;
};

const refreshTaskMap = new Map<string, Promise<RefreshedTokens>>();
const refreshResultCache = new Map<
    string,
    { tokens: RefreshedTokens; expiresAt: number }
>();
const REFRESH_RESULT_CACHE_TTL_MS = 5000;
const SESSION_USER_CACHE_TTL_VERSION = "v1";
function hashAccessToken(accessToken: string): string {
    return createHash("sha256").update(accessToken).digest("hex");
}

function buildSessionUserCacheKey(accessToken: string): string {
    return `${SESSION_USER_CACHE_TTL_VERSION}:${hashAccessToken(accessToken)}`;
}

async function loadSessionUserFromCache(
    accessToken: string,
): Promise<SessionUser | null> {
    const normalizedToken = String(accessToken || "").trim();
    if (!normalizedToken) {
        return null;
    }
    return await cacheManager.get<SessionUserCacheEntry>(
        "session-user",
        buildSessionUserCacheKey(normalizedToken),
    );
}

function saveSessionUserToCache(accessToken: string, user: SessionUser): void {
    const normalizedToken = String(accessToken || "").trim();
    if (!normalizedToken) {
        return;
    }
    void cacheManager.set(
        "session-user",
        buildSessionUserCacheKey(normalizedToken),
        user,
    );
}

export function invalidateSessionUserCache(accessToken: string): void {
    const normalizedToken = String(accessToken || "").trim();
    if (!normalizedToken) {
        return;
    }
    void cacheManager.invalidate(
        "session-user",
        buildSessionUserCacheKey(normalizedToken),
    );
}

function toDisplayName(params: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
}): string {
    const firstName = (params.firstName || "").trim();
    const lastName = (params.lastName || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (fullName) {
        return fullName;
    }
    if (params.email.trim()) {
        return params.email.trim();
    }
    return `user-${params.id.slice(0, 8)}`;
}

function extractRole(
    meRole: DirectusMe["role"] | undefined,
    fallbackRole: AppUser["role"] | undefined | null,
): { roleId?: string; roleName?: string } {
    const role = meRole ?? fallbackRole;
    if (!role) {
        return {};
    }
    if (typeof role === "string") {
        return { roleId: role };
    }
    const roleId = typeof role.id === "string" ? role.id : undefined;
    const roleName = typeof role.name === "string" ? role.name : undefined;
    return { roleId, roleName };
}

async function loadPolicyNameMap(): Promise<Map<string, string>> {
    const registry = await loadDirectusAccessRegistry();
    return new Map(registry.policyNameById);
}

function decodeBase64Url(value: string): string | null {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
    );
    try {
        return Buffer.from(padded, "base64").toString("utf8");
    } catch {
        return null;
    }
}

/**
 * 从 Access Token 中读取 admin_access claim。
 * 只信任 Directus token 的布尔语义，避免角色名字符串匹配误判管理员。
 */
function readAdminAccessFromToken(accessToken: string): boolean {
    const payloadSegment = accessToken.split(".")[1];
    if (!payloadSegment) {
        return false;
    }
    const decoded = decodeBase64Url(payloadSegment);
    if (!decoded) {
        return false;
    }
    try {
        const payload = JSON.parse(decoded) as JwtPayload;
        if (typeof payload.admin_access === "boolean") {
            return payload.admin_access;
        }
        if (typeof payload.admin_access === "string") {
            return payload.admin_access.toLowerCase() === "true";
        }
        if (typeof payload.admin_access === "number") {
            return payload.admin_access === 1;
        }
        return false;
    } catch {
        return false;
    }
}

function resolveAvatarUrl(
    me: DirectusMe,
    fallbackUser?: AppUser | null,
): string | undefined {
    if (me.avatarId) {
        return buildDirectusAssetUrl(me.avatarId, {
            width: 128,
            height: 128,
            fit: "cover",
        });
    }
    const fallbackAvatar =
        fallbackUser?.avatar && String(fallbackUser.avatar).trim()
            ? String(fallbackUser.avatar).trim()
            : undefined;
    if (!fallbackAvatar) {
        return undefined;
    }
    return buildDirectusAssetUrl(fallbackAvatar, {
        width: 128,
        height: 128,
        fit: "cover",
    });
}

// eslint-disable-next-line complexity -- 会话用户需要一次性合并 token、Directus 用户与策略快照
async function buildSessionUser(
    me: DirectusMe,
    accessToken: string,
    fallbackUser?: AppUser | null,
): Promise<SessionUser | null> {
    const id = String(me.id || fallbackUser?.id || "").trim();
    if (!id) {
        return null;
    }
    const email = String(me.email || fallbackUser?.email || "").trim();
    const avatarUrl = resolveAvatarUrl(me, fallbackUser);
    const { roleId, roleName } = extractRole(me.role, fallbackUser?.role);
    const isSystemAdmin = readAdminAccessFromToken(accessToken);
    const embeddedPolicyIds = extractDirectusPolicyIds(fallbackUser?.policies);
    const accessPolicyIds = await loadUserAccessPolicyIds(id);
    const policyIds = Array.from(
        new Set([...embeddedPolicyIds, ...accessPolicyIds]),
    );
    const policyMap = await loadPolicyNameMap().catch(
        () => new Map<string, string>(),
    );
    const policyNames = resolvePolicyNames(policyIds, policyMap);

    return {
        id,
        email,
        name: toDisplayName({
            id,
            email,
            firstName: me.first_name ?? fallbackUser?.first_name,
            lastName: me.last_name ?? fallbackUser?.last_name,
        }),
        avatarUrl,
        avatarFileId: fallbackUser?.avatar || me.avatarId || undefined,
        description:
            typeof fallbackUser?.description === "string"
                ? fallbackUser.description
                : null,
        roleId,
        roleName,
        policyIds,
        policyNames,
        isSystemAdmin,
    };
}

async function loadUserAccessPolicyIds(userId: string): Promise<string[]> {
    try {
        const assignments = await runWithDirectusServiceAccess(
            async () => await listDirectusUserPolicyAssignments([userId]),
        );
        return (assignments.get(userId) ?? [])
            .map((assignment) => assignment.policy)
            .filter(Boolean);
    } catch (error) {
        console.warn(
            "[auth/session] Failed to load directus access policies",
            error,
        );
        return [];
    }
}

async function loadDirectusUserById(userId: string): Promise<AppUser | null> {
    try {
        return await runWithDirectusServiceAccess(() =>
            readOneById("directus_users", userId, {
                fields: [
                    "id",
                    "email",
                    "first_name",
                    "last_name",
                    "description",
                    "avatar",
                    "status",
                    "role.id",
                    "role.name",
                    "policies.*",
                ],
            }),
        );
    } catch (error) {
        console.warn(
            "[auth/session] Failed to load directus user by id",
            error,
        );
        return null;
    }
}

function clearCookie(context: APIContext, cookieName: string): void {
    try {
        context.cookies.delete(cookieName, { path: "/" });
    } catch {
        context.cookies.set(cookieName, "", {
            ...getCookieOptions({
                requestUrl: context.url,
            }),
            maxAge: 0,
        });
    }
}

function setSessionCookies(
    context: APIContext,
    tokens: RefreshedTokens,
    sessionOnly: boolean,
): void {
    context.cookies.set(
        DIRECTUS_REFRESH_COOKIE_NAME,
        tokens.refreshToken,
        getCookieOptions({
            requestUrl: context.url,
            sessionOnly,
        }),
    );
    context.cookies.set(
        DIRECTUS_ACCESS_COOKIE_NAME,
        tokens.accessToken,
        getCookieOptions({
            requestUrl: context.url,
            maxAge: resolveAccessTokenMaxAgeSeconds(tokens.expiresMs),
            sessionOnly,
        }),
    );
}

async function loadUserByAccessToken(
    accessToken: string,
): Promise<SessionUser | null> {
    if (!accessToken) {
        return null;
    }
    try {
        const me = await directusGetMe({ accessToken });
        const fallbackUser = me.id ? await loadDirectusUserById(me.id) : null;
        return await buildSessionUser(me, accessToken, fallbackUser);
    } catch (error) {
        const isAuthError =
            error instanceof DirectusAuthError &&
            (error.directusStatus === 401 || error.directusStatus === 403);
        if (isAuthError) {
            return null;
        }
        throw error;
    }
}

function sweepExpiredRefreshCache(): void {
    const now = Date.now();
    for (const [key, entry] of refreshResultCache) {
        if (entry.expiresAt <= now) {
            refreshResultCache.delete(key);
        }
    }
}

function cacheLocalRefreshResult(
    sourceRefreshToken: string,
    tokens: RefreshedTokens,
): void {
    const cachedValue = {
        tokens,
        expiresAt: Date.now() + REFRESH_RESULT_CACHE_TTL_MS,
    };
    refreshResultCache.set(sourceRefreshToken, cachedValue);
    refreshResultCache.set(tokens.refreshToken, cachedValue);
    sweepExpiredRefreshCache();
}

async function runRefreshTask(
    refreshToken: string,
    releaseDistributedLock?: () => Promise<void>,
): Promise<RefreshedTokens> {
    const task = (async () => {
        try {
            const tokens = await directusRefresh({ refreshToken });
            cacheLocalRefreshResult(refreshToken, tokens);
            void cacheDistributedRefreshResult({
                sourceRefreshToken: refreshToken,
                tokens,
            });
            return tokens;
        } finally {
            if (releaseDistributedLock) {
                try {
                    await releaseDistributedLock();
                } catch {
                    // 分布式锁释放失败时依赖 TTL 自动回收
                }
            }
        }
    })().finally(() => {
        refreshTaskMap.delete(refreshToken);
    });

    refreshTaskMap.set(refreshToken, task);
    return await task;
}

async function refreshWithLock(refreshToken: string): Promise<RefreshedTokens> {
    const cached = refreshResultCache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.tokens;
    }
    if (cached) {
        refreshResultCache.delete(refreshToken);
    }

    const distributedCached = await getDistributedRefreshResult(refreshToken);
    if (distributedCached) {
        cacheLocalRefreshResult(refreshToken, distributedCached);
        return distributedCached;
    }

    const activeTask = refreshTaskMap.get(refreshToken);
    if (activeTask) {
        return await activeTask;
    }

    const distributedLock =
        await tryAcquireDistributedRefreshLock(refreshToken);
    if (distributedLock.status === "busy") {
        const waitedTokens = await waitDistributedRefreshResult(refreshToken);
        if (waitedTokens) {
            cacheLocalRefreshResult(refreshToken, waitedTokens);
            return waitedTokens;
        }

        const retryLock = await tryAcquireDistributedRefreshLock(refreshToken);
        if (retryLock.status === "acquired") {
            return await runRefreshTask(refreshToken, retryLock.release);
        }
        if (retryLock.status === "busy") {
            const retriedWaitTokens = await waitDistributedRefreshResult(
                refreshToken,
                {
                    timeoutMs: 800,
                },
            );
            if (retriedWaitTokens) {
                cacheLocalRefreshResult(refreshToken, retriedWaitTokens);
                return retriedWaitTokens;
            }
        }

        return await runRefreshTask(refreshToken);
    }

    if (distributedLock.status === "acquired") {
        return await runRefreshTask(refreshToken, distributedLock.release);
    }

    return await runRefreshTask(refreshToken);
}

async function resolveUserFromAccessToken(
    context: APIContext,
    accessToken: string,
): Promise<SessionUser | null | "continue"> {
    const cached = await loadSessionUserFromCache(accessToken).catch(
        () => null,
    );
    if (cached) {
        return cached;
    }
    try {
        const user = await loadUserByAccessToken(accessToken);
        if (user) {
            saveSessionUserToCache(accessToken, user);
            return user;
        }
        invalidateSessionUserCache(accessToken);
        clearCookie(context, DIRECTUS_ACCESS_COOKIE_NAME);
        return "continue";
    } catch (error) {
        console.warn(
            "[auth/session] Transient error resolving user from access token, trying refresh path",
            error,
        );
        return "continue";
    }
}

async function resolveUserFromRefreshedTokens(
    context: APIContext,
    tokens: RefreshedTokens,
): Promise<SessionUser | null> {
    const cached = await loadSessionUserFromCache(tokens.accessToken).catch(
        () => null,
    );
    if (cached) {
        return cached;
    }
    try {
        const user = await loadUserByAccessToken(tokens.accessToken);
        if (!user) {
            invalidateSessionUserCache(tokens.accessToken);
            clearSession(context);
            return null;
        }
        saveSessionUserToCache(tokens.accessToken, user);
        return user;
    } catch (error) {
        console.warn(
            "[auth/session] Transient error in resolveUserFromRefreshedTokens",
            error,
        );
        return null;
    }
}

function resolveSessionOnlyMode(context: APIContext): boolean {
    const rememberValue =
        context.cookies.get(REMEMBER_COOKIE_NAME)?.value ?? undefined;
    return isSessionOnlyMode(rememberValue);
}

async function tryRecoverUserFromDistributedRefresh(
    context: APIContext,
    refreshToken: string,
): Promise<SessionUser | null | undefined> {
    const recoveredTokens = await getDistributedRefreshResult(refreshToken);
    if (!recoveredTokens) {
        return undefined;
    }
    const sessionOnly = resolveSessionOnlyMode(context);
    setSessionCookies(context, recoveredTokens, sessionOnly);
    return await resolveUserFromRefreshedTokens(context, recoveredTokens);
}

async function resolveUserFromRefreshToken(
    context: APIContext,
    refreshToken: string,
): Promise<SessionUser | null> {
    try {
        const tokens = await refreshWithLock(refreshToken);
        const sessionOnly = resolveSessionOnlyMode(context);
        setSessionCookies(context, tokens, sessionOnly);
        return await resolveUserFromRefreshedTokens(context, tokens);
    } catch (error) {
        const isDefinitiveAuthError =
            error instanceof DirectusAuthError &&
            (error.directusStatus === 401 || error.directusStatus === 403);
        if (!isDefinitiveAuthError) {
            return null;
        }

        const recoveredUser = await tryRecoverUserFromDistributedRefresh(
            context,
            refreshToken,
        );
        if (recoveredUser !== undefined) {
            return recoveredUser;
        }

        clearSession(context);
        return null;
    }
}

export async function getSessionUser(
    context: APIContext,
): Promise<SessionUser | null> {
    const accessToken =
        context.cookies.get(DIRECTUS_ACCESS_COOKIE_NAME)?.value || "";
    if (accessToken) {
        const result = await resolveUserFromAccessToken(context, accessToken);
        if (result !== "continue") {
            return result;
        }
    }

    const refreshToken =
        context.cookies.get(DIRECTUS_REFRESH_COOKIE_NAME)?.value || "";
    if (!refreshToken) {
        return null;
    }

    return await resolveUserFromRefreshToken(context, refreshToken);
}

export function getSessionAccessToken(context: APIContext): string {
    return (
        context.cookies.get(DIRECTUS_ACCESS_COOKIE_NAME)?.value?.trim() || ""
    );
}

export function clearSession(context: APIContext): void {
    clearCookie(context, DIRECTUS_REFRESH_COOKIE_NAME);
    clearCookie(context, DIRECTUS_ACCESS_COOKIE_NAME);
    clearCookie(context, REMEMBER_COOKIE_NAME);
}
