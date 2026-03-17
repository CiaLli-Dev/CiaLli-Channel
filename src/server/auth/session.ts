import { createHash } from "node:crypto";
import type { APIContext } from "astro";

import type { AppUser } from "@/types/app";
import { cacheManager } from "@/server/cache/manager";
import { readOneById } from "@/server/directus/client";
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
    roleId?: string;
    roleName?: string;
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

function invalidateSessionUserCache(accessToken: string): void {
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

function buildSessionUser(
    me: DirectusMe,
    accessToken: string,
    fallbackUser?: AppUser | null,
): SessionUser | null {
    const id = String(me.id || fallbackUser?.id || "").trim();
    if (!id) {
        return null;
    }
    const email = String(me.email || fallbackUser?.email || "").trim();
    const avatarFromMe = me.avatarId
        ? buildDirectusAssetUrl(me.avatarId, {
              width: 128,
              height: 128,
              fit: "cover",
          })
        : undefined;
    const avatarFromFallback =
        fallbackUser?.avatar && String(fallbackUser.avatar).trim()
            ? buildDirectusAssetUrl(String(fallbackUser.avatar).trim(), {
                  width: 128,
                  height: 128,
                  fit: "cover",
              })
            : undefined;
    const { roleId, roleName } = extractRole(me.role, fallbackUser?.role);
    const isSystemAdmin = readAdminAccessFromToken(accessToken);

    return {
        id,
        email,
        name: toDisplayName({
            id,
            email,
            firstName: me.first_name ?? fallbackUser?.first_name,
            lastName: me.last_name ?? fallbackUser?.last_name,
        }),
        avatarUrl: avatarFromMe || avatarFromFallback,
        roleId,
        roleName,
        isSystemAdmin,
    };
}

async function loadDirectusUserById(userId: string): Promise<AppUser | null> {
    try {
        return await readOneById("directus_users", userId, {
            fields: [
                "id",
                "email",
                "first_name",
                "last_name",
                "avatar",
                "role",
            ],
        });
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
        return buildSessionUser(me, accessToken, fallbackUser);
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

async function refreshWithLock(refreshToken: string): Promise<RefreshedTokens> {
    const cached = refreshResultCache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.tokens;
    }
    if (cached) {
        refreshResultCache.delete(refreshToken);
    }

    const activeTask = refreshTaskMap.get(refreshToken);
    if (activeTask) {
        return await activeTask;
    }

    const task = directusRefresh({ refreshToken })
        .then((tokens) => {
            const cachedValue = {
                tokens,
                expiresAt: Date.now() + REFRESH_RESULT_CACHE_TTL_MS,
            };
            refreshResultCache.set(refreshToken, cachedValue);
            refreshResultCache.set(tokens.refreshToken, cachedValue);
            return tokens;
        })
        .finally(() => {
            refreshTaskMap.delete(refreshToken);
        });
    refreshTaskMap.set(refreshToken, task);
    return await task;
}

export async function getSessionUser(
    context: APIContext,
): Promise<SessionUser | null> {
    const accessToken =
        context.cookies.get(DIRECTUS_ACCESS_COOKIE_NAME)?.value || "";
    if (accessToken) {
        try {
            const cached = await loadSessionUserFromCache(accessToken);
            if (cached) {
                return cached;
            }
            const user = await loadUserByAccessToken(accessToken);
            if (user) {
                saveSessionUserToCache(accessToken, user);
                return user;
            }
            invalidateSessionUserCache(accessToken);
            clearCookie(context, DIRECTUS_ACCESS_COOKIE_NAME);
        } catch {
            return null;
        }
    }

    const refreshToken =
        context.cookies.get(DIRECTUS_REFRESH_COOKIE_NAME)?.value || "";
    if (!refreshToken) {
        return null;
    }

    try {
        const tokens = await refreshWithLock(refreshToken);
        const rememberValue =
            context.cookies.get(REMEMBER_COOKIE_NAME)?.value ?? undefined;
        const sessionOnly = isSessionOnlyMode(rememberValue);
        setSessionCookies(context, tokens, sessionOnly);
        try {
            const cached = await loadSessionUserFromCache(tokens.accessToken);
            if (cached) {
                return cached;
            }
            const user = await loadUserByAccessToken(tokens.accessToken);
            if (!user) {
                invalidateSessionUserCache(tokens.accessToken);
                clearSession(context);
                return null;
            }
            saveSessionUserToCache(tokens.accessToken, user);
            return user;
        } catch {
            return null;
        }
    } catch (error) {
        const isDefinitiveAuthError =
            error instanceof DirectusAuthError &&
            (error.directusStatus === 401 || error.directusStatus === 403);
        if (isDefinitiveAuthError) {
            clearSession(context);
        }
        return null;
    }
}

export function clearSession(context: APIContext): void {
    clearCookie(context, DIRECTUS_REFRESH_COOKIE_NAME);
    clearCookie(context, DIRECTUS_ACCESS_COOKIE_NAME);
    clearCookie(context, REMEMBER_COOKIE_NAME);
}
