import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

type CookieSetRecord = {
    name: string;
    value: string;
    options?: unknown;
};

type CookieDeleteRecord = {
    name: string;
    options?: unknown;
};

const hoisted = vi.hoisted(() => {
    class MockDirectusAuthError extends Error {
        readonly directusStatus: number | null;

        constructor(message: string, directusStatus: number | null) {
            super(message);
            this.name = "DirectusAuthError";
            this.directusStatus = directusStatus;
        }
    }

    return {
        cacheGetMock: vi.fn(),
        cacheSetMock: vi.fn(),
        cacheInvalidateMock: vi.fn(),
        readOneByIdMock: vi.fn(),
        runWithDirectusServiceAccessMock: vi.fn(),
        loadDirectusAccessRegistryMock: vi.fn(),
        getDistributedRefreshResultMock: vi.fn(),
        cacheDistributedRefreshResultMock: vi.fn(),
        tryAcquireDistributedRefreshLockMock: vi.fn(),
        waitDistributedRefreshResultMock: vi.fn(),
        directusGetMeMock: vi.fn(),
        directusRefreshMock: vi.fn(),
        getCookieOptionsMock: vi.fn(),
        isSessionOnlyModeMock: vi.fn(),
        resolveAccessTokenMaxAgeSecondsMock: vi.fn(),
        MockDirectusAuthError,
    };
});

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: hoisted.cacheGetMock,
        set: hoisted.cacheSetMock,
        invalidate: hoisted.cacheInvalidateMock,
    },
}));

vi.mock("@/server/directus/client", () => ({
    readOneById: hoisted.readOneByIdMock,
    runWithDirectusServiceAccess: hoisted.runWithDirectusServiceAccessMock,
}));

vi.mock("@/server/auth/directus-access", () => ({
    extractDirectusPolicyIds: vi.fn(() => []),
    resolvePolicyNames: vi.fn(() => []),
}));

vi.mock("@/server/auth/directus-registry", () => ({
    loadDirectusAccessRegistry: hoisted.loadDirectusAccessRegistryMock,
}));

vi.mock("@/server/auth/refresh-coordinator", () => ({
    getDistributedRefreshResult: hoisted.getDistributedRefreshResultMock,
    cacheDistributedRefreshResult: hoisted.cacheDistributedRefreshResultMock,
    tryAcquireDistributedRefreshLock:
        hoisted.tryAcquireDistributedRefreshLockMock,
    waitDistributedRefreshResult: hoisted.waitDistributedRefreshResultMock,
}));

vi.mock("@/server/directus-auth", () => {
    return {
        DIRECTUS_ACCESS_COOKIE_NAME: "cialli_directus_access",
        DIRECTUS_REFRESH_COOKIE_NAME: "cialli_directus_refresh",
        REMEMBER_COOKIE_NAME: "cialli_remember",
        DirectusAuthError: hoisted.MockDirectusAuthError,
        buildDirectusAssetUrl: vi.fn(
            (fileId: string) => `/api/v1/assets/${fileId}`,
        ),
        directusGetMe: hoisted.directusGetMeMock,
        directusRefresh: hoisted.directusRefreshMock,
        getCookieOptions: hoisted.getCookieOptionsMock,
        isSessionOnlyMode: hoisted.isSessionOnlyModeMock,
        resolveAccessTokenMaxAgeSeconds:
            hoisted.resolveAccessTokenMaxAgeSecondsMock,
    };
});

import {
    DIRECTUS_ACCESS_COOKIE_NAME,
    DIRECTUS_REFRESH_COOKIE_NAME,
    DirectusAuthError,
    REMEMBER_COOKIE_NAME,
    directusGetMe,
    directusRefresh,
} from "@/server/directus-auth";
import {
    getDistributedRefreshResult,
    tryAcquireDistributedRefreshLock,
    waitDistributedRefreshResult,
} from "@/server/auth/refresh-coordinator";
import { getSessionUser } from "@/server/auth/session";

const mockedDirectusGetMe = vi.mocked(directusGetMe);
const mockedDirectusRefresh = vi.mocked(directusRefresh);
const mockedGetDistributedRefreshResult = vi.mocked(
    getDistributedRefreshResult,
);
const mockedTryAcquireDistributedRefreshLock = vi.mocked(
    tryAcquireDistributedRefreshLock,
);
const mockedWaitDistributedRefreshResult = vi.mocked(
    waitDistributedRefreshResult,
);

function buildAccessToken(adminAccess = false): string {
    const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({ admin_access: adminAccess }),
    ).toString("base64url");
    return `${header}.${payload}.sig`;
}

function createSessionContext(initialCookies: Record<string, string>): {
    context: APIContext;
    setRecords: CookieSetRecord[];
    deleteRecords: CookieDeleteRecord[];
} {
    const cookieMap = new Map<string, string>(Object.entries(initialCookies));
    const setRecords: CookieSetRecord[] = [];
    const deleteRecords: CookieDeleteRecord[] = [];

    const context = {
        url: new URL("https://cialli.test/api/v1/public/home"),
        cookies: {
            get(name: string): { value: string } | undefined {
                const value = cookieMap.get(name);
                if (value === undefined) {
                    return undefined;
                }
                return { value };
            },
            set(name: string, value: string, options?: unknown): void {
                cookieMap.set(name, value);
                setRecords.push({ name, value, options });
            },
            delete(name: string, options?: unknown): void {
                cookieMap.delete(name);
                deleteRecords.push({ name, options });
            },
        },
    } as unknown as APIContext;

    return {
        context,
        setRecords,
        deleteRecords,
    };
}

beforeEach(() => {
    vi.clearAllMocks();

    hoisted.cacheGetMock.mockResolvedValue(null);
    hoisted.cacheSetMock.mockResolvedValue(undefined);
    hoisted.cacheInvalidateMock.mockResolvedValue(undefined);

    hoisted.readOneByIdMock.mockResolvedValue(null);
    hoisted.runWithDirectusServiceAccessMock.mockImplementation(
        async () => null,
    );

    hoisted.loadDirectusAccessRegistryMock.mockResolvedValue({
        policyNameById: new Map<string, string>(),
    });

    hoisted.getCookieOptionsMock.mockReturnValue({ path: "/" });
    hoisted.isSessionOnlyModeMock.mockReturnValue(false);
    hoisted.resolveAccessTokenMaxAgeSecondsMock.mockReturnValue(900);

    mockedGetDistributedRefreshResult.mockResolvedValue(null);
    hoisted.cacheDistributedRefreshResultMock.mockResolvedValue(undefined);
    mockedTryAcquireDistributedRefreshLock.mockResolvedValue({
        status: "unavailable",
    });
    mockedWaitDistributedRefreshResult.mockResolvedValue(null);
});

describe("auth/session refresh race", () => {
    it("刷新 401 时命中共享结果，不会误清 refresh/remember cookie", async () => {
        const releaseMock = vi.fn().mockResolvedValue(undefined);
        const expiredAccessToken = buildAccessToken(false);
        const recoveredAccessToken = buildAccessToken(false);
        const refreshToken = "refresh-old-race-hit";

        mockedDirectusGetMe
            .mockRejectedValueOnce(new DirectusAuthError("expired", 401))
            .mockResolvedValueOnce({
                id: "user-1",
                email: "user-1@example.com",
                first_name: "User",
                last_name: "One",
                avatarId: undefined,
                role: undefined,
            });

        mockedDirectusRefresh.mockRejectedValueOnce(
            new DirectusAuthError("refresh-reused", 401),
        );

        mockedGetDistributedRefreshResult
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                accessToken: recoveredAccessToken,
                refreshToken: "refresh-next",
                expiresMs: 900_000,
            });

        mockedTryAcquireDistributedRefreshLock.mockResolvedValueOnce({
            status: "acquired",
            release: releaseMock,
        });

        const { context, setRecords, deleteRecords } = createSessionContext({
            [DIRECTUS_ACCESS_COOKIE_NAME]: expiredAccessToken,
            [DIRECTUS_REFRESH_COOKIE_NAME]: refreshToken,
            [REMEMBER_COOKIE_NAME]: "1",
        });

        const user = await getSessionUser(context);

        expect(user?.id).toBe("user-1");
        expect(releaseMock).toHaveBeenCalledTimes(1);
        expect(
            setRecords.some(
                (record) => record.name === DIRECTUS_ACCESS_COOKIE_NAME,
            ),
        ).toBe(true);
        expect(
            setRecords.some(
                (record) => record.name === DIRECTUS_REFRESH_COOKIE_NAME,
            ),
        ).toBe(true);

        const deletedNames = deleteRecords.map((record) => record.name);
        expect(deletedNames).not.toContain(DIRECTUS_REFRESH_COOKIE_NAME);
        expect(deletedNames).not.toContain(REMEMBER_COOKIE_NAME);
    });

    it("刷新 401 且无共享结果时仍会清理会话", async () => {
        const releaseMock = vi.fn().mockResolvedValue(undefined);
        const expiredAccessToken = buildAccessToken(false);
        const refreshToken = "refresh-old-race-miss";

        mockedDirectusGetMe.mockRejectedValueOnce(
            new DirectusAuthError("expired", 401),
        );
        mockedDirectusRefresh.mockRejectedValueOnce(
            new DirectusAuthError("refresh-reused", 401),
        );
        mockedGetDistributedRefreshResult
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null);
        mockedTryAcquireDistributedRefreshLock.mockResolvedValueOnce({
            status: "acquired",
            release: releaseMock,
        });

        const { context, deleteRecords } = createSessionContext({
            [DIRECTUS_ACCESS_COOKIE_NAME]: expiredAccessToken,
            [DIRECTUS_REFRESH_COOKIE_NAME]: refreshToken,
            [REMEMBER_COOKIE_NAME]: "1",
        });

        const user = await getSessionUser(context);

        expect(user).toBeNull();
        expect(releaseMock).toHaveBeenCalledTimes(1);

        const deletedNames = deleteRecords.map((record) => record.name);
        expect(deletedNames).toContain(DIRECTUS_REFRESH_COOKIE_NAME);
        expect(deletedNames).toContain(REMEMBER_COOKIE_NAME);
    });

    it("分布式锁忙时可通过等待共享结果恢复且不触发 directusRefresh", async () => {
        const refreshedAccessToken = buildAccessToken(false);
        const refreshToken = "refresh-old-race-busy";

        mockedDirectusGetMe.mockResolvedValueOnce({
            id: "user-2",
            email: "user-2@example.com",
            first_name: "User",
            last_name: "Two",
            avatarId: undefined,
            role: undefined,
        });

        mockedGetDistributedRefreshResult.mockResolvedValueOnce(null);
        mockedTryAcquireDistributedRefreshLock.mockResolvedValueOnce({
            status: "busy",
        });
        mockedWaitDistributedRefreshResult.mockResolvedValueOnce({
            accessToken: refreshedAccessToken,
            refreshToken: "refresh-next",
            expiresMs: 900_000,
        });

        const { context, deleteRecords } = createSessionContext({
            [DIRECTUS_REFRESH_COOKIE_NAME]: refreshToken,
        });

        const user = await getSessionUser(context);

        expect(user?.id).toBe("user-2");
        expect(mockedDirectusRefresh).not.toHaveBeenCalled();

        const deletedNames = deleteRecords.map((record) => record.name);
        expect(deletedNames).not.toContain(DIRECTUS_REFRESH_COOKIE_NAME);
        expect(deletedNames).not.toContain(REMEMBER_COOKIE_NAME);
    });
});
