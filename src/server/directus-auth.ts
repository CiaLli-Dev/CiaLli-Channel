import type { AstroCookieSetOptions } from "astro";
import {
    createDirectus,
    isDirectusError,
    login,
    logout,
    readMe,
    refresh,
    rest,
    withToken,
} from "@directus/sdk";

import type { JsonObject, JsonValue } from "@/types/json";
import { getJsonString, isJsonObject } from "@/utils/json-utils";
import { internal } from "@/server/api/errors";

type DirectusAuthTokens = {
    accessToken: string;
    refreshToken: string;
    expiresMs?: number;
};

type DirectusMe = {
    id?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    role?: string | { id?: string; name?: string };
    avatarId?: string;
};

export type PublicUserInfo = {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string;
};

const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ACCESS_COOKIE_DEFAULT_MAX_AGE_SECONDS = 60 * 15;
const ACCESS_COOKIE_MIN_MAX_AGE_SECONDS = 60;
const ACCESS_COOKIE_MAX_MAX_AGE_SECONDS = 60 * 60 * 24;

export const DIRECTUS_ACCESS_COOKIE_NAME = "cialli_directus_access";
export const DIRECTUS_REFRESH_COOKIE_NAME = "cialli_directus_refresh";
export const REMEMBER_COOKIE_NAME = "cialli_remember";

function resolveCookieSecure(requestUrl?: URL): boolean {
    if (import.meta.env.PROD) {
        return true;
    }
    if (requestUrl) {
        return requestUrl.protocol === "https:";
    }
    return false;
}

function clampCookieMaxAge(value: number): number {
    if (!Number.isFinite(value)) {
        return ACCESS_COOKIE_DEFAULT_MAX_AGE_SECONDS;
    }
    return Math.max(
        ACCESS_COOKIE_MIN_MAX_AGE_SECONDS,
        Math.min(ACCESS_COOKIE_MAX_MAX_AGE_SECONDS, Math.floor(value)),
    );
}

export function resolveAccessTokenMaxAgeSeconds(expiresMs?: number): number {
    if (!Number.isFinite(expiresMs)) {
        return ACCESS_COOKIE_DEFAULT_MAX_AGE_SECONDS;
    }

    const raw = Number(expiresMs);
    if (raw <= 0) {
        return ACCESS_COOKIE_DEFAULT_MAX_AGE_SECONDS;
    }

    let maxAgeSeconds: number;
    // Directus may return duration (ms/s) or an absolute epoch timestamp.
    if (raw > Date.now()) {
        maxAgeSeconds = (raw - Date.now()) / 1000;
    } else if (raw >= 1000) {
        maxAgeSeconds = raw / 1000;
    } else {
        maxAgeSeconds = raw;
    }

    return clampCookieMaxAge(maxAgeSeconds - 10);
}

export function isSessionOnlyMode(value: string | undefined | null): boolean {
    return value === "0";
}

export function getCookieOptions(params?: {
    requestUrl?: URL;
    maxAge?: number;
    sessionOnly?: boolean;
}): AstroCookieSetOptions {
    const base: AstroCookieSetOptions = {
        httpOnly: true,
        secure: resolveCookieSecure(params?.requestUrl),
        sameSite: "lax" as const,
        path: "/",
    };
    if (params?.sessionOnly) {
        return base;
    }
    return {
        ...base,
        maxAge:
            typeof params?.maxAge === "number"
                ? Math.max(0, Math.floor(params.maxAge))
                : REFRESH_COOKIE_MAX_AGE_SECONDS,
    };
}

export function getRememberCookieOptions(params: {
    requestUrl?: URL;
    remember: boolean;
}): AstroCookieSetOptions {
    const base: AstroCookieSetOptions = {
        httpOnly: true,
        secure: resolveCookieSecure(params.requestUrl),
        sameSite: "lax" as const,
        path: "/",
    };
    if (!params.remember) {
        return base;
    }
    return {
        ...base,
        maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
    };
}

export function getDirectusUrl(): string {
    const url = process.env.DIRECTUS_URL || import.meta.env.DIRECTUS_URL || "";
    if (!url.trim()) {
        throw internal("DIRECTUS_URL 未配置");
    }
    return url.trim().replace(/\/+$/, "");
}

export function getDirectusStaticToken(): string {
    const token =
        process.env.DIRECTUS_STATIC_TOKEN ||
        import.meta.env.DIRECTUS_STATIC_TOKEN;
    if (!token || !token.trim()) {
        throw internal("DIRECTUS_STATIC_TOKEN 未配置");
    }
    return token.trim();
}

function extractDirectusFileId(
    value: JsonValue | undefined,
): string | undefined {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (value && isJsonObject(value)) {
        const id = getJsonString(value, "id");
        if (id && id.trim()) {
            return id.trim();
        }
    }
    return undefined;
}

export function buildDirectusAssetUrl(
    fileId: string,
    options?: {
        width?: number;
        height?: number;
        fit?: string;
        quality?: number;
    },
): string {
    const url = new URL(
        `/api/v1/public/assets/${encodeURIComponent(fileId)}`,
        "http://localhost",
    );

    if (options?.width) {
        url.searchParams.set("width", String(options.width));
    }
    if (options?.height) {
        url.searchParams.set("height", String(options.height));
    }
    if (options?.fit) {
        url.searchParams.set("fit", options.fit);
    }
    if (options?.quality) {
        url.searchParams.set("quality", String(options.quality));
    }

    return `${url.pathname}${url.search}`;
}

/**
 * 构建公开资源直链 URL。当配置了 PUBLIC_ASSET_BASE_URL 时直接拼接外部地址，
 * 否则回退到 BFF 代理路径。
 */
export function buildPublicAssetUrl(
    fileId: string,
    options?: {
        width?: number;
        height?: number;
        fit?: string;
        quality?: number;
        format?: string;
    },
): string {
    const baseUrl = (
        process.env.PUBLIC_ASSET_BASE_URL ||
        import.meta.env.PUBLIC_ASSET_BASE_URL ||
        ""
    )
        .toString()
        .trim();
    if (!baseUrl) {
        return buildDirectusAssetUrl(fileId, options);
    }

    const url = new URL(`/${encodeURIComponent(fileId)}`, baseUrl);
    if (options?.width) {
        url.searchParams.set("width", String(options.width));
    }
    if (options?.height) {
        url.searchParams.set("height", String(options.height));
    }
    if (options?.fit) {
        url.searchParams.set("fit", options.fit);
    }
    if (options?.quality) {
        url.searchParams.set("quality", String(options.quality));
    }
    if (options?.format) {
        url.searchParams.set("format", options.format);
    }
    return url.toString();
}

// 认证请求超时（毫秒）— 登录/刷新/readMe 均为轻量操作，10 秒足够
const AUTH_FETCH_TIMEOUT_MS = 10_000;

// 提取构建逻辑，让 TypeScript 推断包含 rest() 扩展（.request() 方法）的完整类型
function buildDirectusAuthClient() {
    return createDirectus(getDirectusUrl()).with(
        rest({
            onRequest: (options) => ({
                ...options,
                signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS),
            }),
        }),
    );
}

let authClientSingleton: ReturnType<typeof buildDirectusAuthClient> | null =
    null;

function getDirectusAuthClient() {
    if (authClientSingleton) return authClientSingleton;
    authClientSingleton = buildDirectusAuthClient();
    console.info("[directus/auth] 认证客户端初始化");
    return authClientSingleton;
}

export class DirectusAuthError extends Error {
    readonly directusStatus: number | null;
    constructor(message: string, directusStatus: number | null) {
        super(message);
        this.name = "DirectusAuthError";
        this.directusStatus = directusStatus;
    }
}

function getDirectusErrorStatus(error: unknown): number | null {
    if (!isDirectusError(error)) {
        return null;
    }
    const response = error.response;
    if (response instanceof Response) {
        return response.status;
    }
    return null;
}

function toDirectusAuthError(
    action: string,
    error: unknown,
): DirectusAuthError {
    if (!isDirectusError(error)) {
        const msg =
            error instanceof Error
                ? error.message
                : `[directus/auth] ${action}失败: ${String(error)}`;
        return new DirectusAuthError(msg, null);
    }

    const status = getDirectusErrorStatus(error);
    const statusText =
        typeof status === "number" ? `(${status})` : "(unknown status)";
    const codes = error.errors
        ?.map((entry) => entry.extensions?.code)
        .filter(
            (code): code is string => typeof code === "string" && Boolean(code),
        )
        .join(",");
    const detail =
        error.errors
            ?.map((entry) => {
                const code = entry.extensions?.code || "UNKNOWN";
                return `${code}:${entry.message}`;
            })
            .join("; ") || error.message;

    return new DirectusAuthError(
        `[directus/auth] ${action}失败 ${statusText}${codes ? ` codes=${codes}` : ""}: ${detail}`,
        status,
    );
}

async function runDirectusAuthRequest<T>(
    action: string,
    request: () => Promise<T>,
): Promise<T> {
    try {
        return await request();
    } catch (error) {
        throw toDirectusAuthError(action, error);
    }
}

function parseExpiresMs(value: JsonValue | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function parseTokens(payload: JsonValue): DirectusAuthTokens {
    if (!isJsonObject(payload)) {
        throw internal("Directus 登录/刷新响应不是对象");
    }

    const accessToken = getJsonString(payload, "access_token") ?? "";
    const refreshToken = getJsonString(payload, "refresh_token") ?? "";

    const expiresRaw =
        payload.expires ?? payload.expires_in ?? payload.expires_at;

    if (!accessToken || !refreshToken) {
        throw internal("Directus 登录/刷新响应缺少 token");
    }

    const expiresMs = parseExpiresMs(expiresRaw);

    return { accessToken, refreshToken, expiresMs };
}

export async function directusLogin(params: {
    email: string;
    password: string;
}): Promise<DirectusAuthTokens> {
    const payload = await runDirectusAuthRequest("登录", async () => {
        return await getDirectusAuthClient().request(
            login(
                {
                    email: params.email,
                    password: params.password,
                },
                {
                    mode: "json",
                },
            ),
        );
    });
    return parseTokens(payload as unknown as JsonValue);
}

export async function directusRefresh(params: {
    refreshToken: string;
}): Promise<DirectusAuthTokens> {
    const payload = await runDirectusAuthRequest("刷新登录态", async () => {
        return await getDirectusAuthClient().request(
            refresh({
                refresh_token: params.refreshToken,
                mode: "json",
            }),
        );
    });
    return parseTokens(payload as unknown as JsonValue);
}

export async function directusLogout(params: {
    refreshToken: string;
}): Promise<void> {
    await runDirectusAuthRequest("退出登录", async () => {
        await getDirectusAuthClient().request(
            logout({
                refresh_token: params.refreshToken,
                mode: "json",
            }),
        );
    });
}

export async function directusGetMe(params: {
    accessToken: string;
}): Promise<DirectusMe> {
    const payload = await runDirectusAuthRequest("读取当前用户", async () => {
        return await getDirectusAuthClient().request(
            withToken(
                params.accessToken,
                readMe({
                    fields: [
                        "id",
                        "email",
                        "first_name",
                        "last_name",
                        "avatar",
                        "role",
                    ],
                } as never),
            ),
        );
    });

    const data: JsonObject = isJsonObject(payload as JsonValue)
        ? ((payload as unknown as JsonObject) ?? {})
        : {};

    const idValue = data.id;
    const id =
        typeof idValue === "string" && idValue.trim()
            ? idValue
            : typeof idValue === "number"
              ? String(idValue)
              : undefined;

    const email = getJsonString(data, "email");
    const first_name = getJsonString(data, "first_name");
    const last_name = getJsonString(data, "last_name");

    const roleValue = data.role;
    const role: DirectusMe["role"] | undefined =
        typeof roleValue === "string"
            ? roleValue
            : isJsonObject(roleValue)
              ? {
                    id: getJsonString(roleValue, "id"),
                    name: getJsonString(roleValue, "name"),
                }
              : undefined;
    return {
        id,
        email: email && email.trim() ? email : undefined,
        first_name: first_name && first_name.trim() ? first_name : undefined,
        last_name: last_name && last_name.trim() ? last_name : undefined,
        role,
        avatarId: extractDirectusFileId(data.avatar),
    };
}

export function pickPublicUserInfo(me: DirectusMe): PublicUserInfo {
    const name = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
    return {
        id: me.id ?? "",
        email: me.email ?? "",
        name: name || me.email || "Member",
        avatarUrl: me.avatarId
            ? buildDirectusAssetUrl(me.avatarId, {
                  width: 128,
                  height: 128,
                  fit: "cover",
              })
            : undefined,
    };
}

export function getClientIp(headers: Headers): string {
    const vercelForwarded = headers.get("x-vercel-forwarded-for");
    if (vercelForwarded) {
        return vercelForwarded.split(",")[0]?.trim() || "unknown";
    }
    const cloudflare = headers.get("cf-connecting-ip");
    if (cloudflare) {
        return cloudflare.trim();
    }
    const realIp = headers.get("x-real-ip");
    if (realIp) {
        return realIp.trim();
    }
    return "unknown";
}

type RateLimitRecord = { count: number; resetAt: number };
const loginRateLimit = new Map<string, RateLimitRecord>();

export type LoginRateLimitResult =
    | { ok: true; remaining: number; resetAt: number }
    | { ok: false; remaining: 0; resetAt: number };

export function checkLoginRateLimit(
    ip: string,
    options?: { limit?: number; windowMs?: number },
): LoginRateLimitResult {
    const limit = options?.limit ?? 10;
    const windowMs = options?.windowMs ?? 5 * 60 * 1000;

    const now = Date.now();
    const existing = loginRateLimit.get(ip);
    if (!existing || existing.resetAt <= now) {
        loginRateLimit.set(ip, { count: 1, resetAt: now + windowMs });
        return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    if (existing.count >= limit) {
        return { ok: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    loginRateLimit.set(ip, existing);
    return {
        ok: true,
        remaining: Math.max(0, limit - existing.count),
        resetAt: existing.resetAt,
    };
}
