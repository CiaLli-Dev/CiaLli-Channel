import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthStateModule = typeof import("@/scripts/auth/state");

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function clearAuthStateCache(): void {
    delete (
        window as Window &
            typeof globalThis & {
                __cialliAuthState?: unknown;
            }
    ).__cialliAuthState;
}

async function loadAuthStateModule(): Promise<AuthStateModule> {
    vi.resetModules();
    clearAuthStateCache();
    return await import("@/scripts/auth/state");
}

describe("auth state refresh", () => {
    beforeEach(() => {
        clearAuthStateCache();
        vi.unstubAllGlobals();
    });

    it("dedupes concurrent refreshes through one optional auth probe", async () => {
        const authState = await loadAuthStateModule();
        const pending = deferred<Response>();
        const fetchMock =
            vi.fn<
                (
                    input: RequestInfo | URL,
                    init?: RequestInit,
                ) => Promise<Response>
            >();
        fetchMock.mockReturnValueOnce(pending.promise);
        vi.stubGlobal("fetch", fetchMock);

        const first = authState.refreshAuthState();
        const second = authState.refreshAuthState();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        pending.resolve(
            jsonResponse({
                ok: true,
                is_admin: true,
                user: {
                    id: "admin-1",
                    username: "alice",
                    name: "Alice",
                    email: "alice@example.com",
                    avatarUrl: "/api/v1/assets/avatar",
                },
            }),
        );

        await expect(first).resolves.toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
            displayName: "Alice",
            avatarUrl: "/api/v1/assets/avatar",
        });
        await expect(second).resolves.toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
    });

    it("does not let an older refresh response override a newer admin state", async () => {
        const authState = await loadAuthStateModule();
        const firstPending = deferred<Response>();
        const secondPending = deferred<Response>();
        const fetchMock =
            vi.fn<
                (
                    input: RequestInfo | URL,
                    init?: RequestInit,
                ) => Promise<Response>
            >();
        fetchMock
            .mockReturnValueOnce(firstPending.promise)
            .mockReturnValueOnce(secondPending.promise);
        vi.stubGlobal("fetch", fetchMock);

        const older = authState.refreshAuthState();
        const newer = authState.refreshAuthState({ force: true });

        secondPending.resolve(
            jsonResponse({
                ok: true,
                is_admin: true,
                user: { id: "admin-1", username: "alice", name: "Alice" },
            }),
        );
        await expect(newer).resolves.toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            username: "alice",
        });

        firstPending.resolve(jsonResponse({ ok: false }));
        await older;

        expect(authState.getAuthState()).toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
    });

    it("keeps the cached admin state when the optional auth probe fails", async () => {
        const authState = await loadAuthStateModule();
        authState.emitAuthState({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
        const fetchMock =
            vi.fn<
                (
                    input: RequestInfo | URL,
                    init?: RequestInit,
                ) => Promise<Response>
            >();
        fetchMock.mockRejectedValueOnce(new Error("network down"));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            authState.refreshAuthState({ force: true }),
        ).resolves.toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
        expect(authState.getAuthState()).toMatchObject({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
    });

    it("publishes logged-out state for an explicit optional logged-out response", async () => {
        const authState = await loadAuthStateModule();
        authState.emitAuthState({
            isLoggedIn: true,
            isAdmin: true,
            userId: "admin-1",
            username: "alice",
        });
        const events: Array<ReturnType<AuthStateModule["getAuthState"]>> = [];
        const unsubscribe = authState.subscribeAuthState((state) => {
            events.push(state);
        });
        const fetchMock =
            vi.fn<
                (
                    input: RequestInfo | URL,
                    init?: RequestInit,
                ) => Promise<Response>
            >();
        fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            authState.refreshAuthState({ force: true }),
        ).resolves.toMatchObject({
            isLoggedIn: false,
            isAdmin: false,
            userId: "",
            username: "",
        });
        unsubscribe();

        expect(events.at(-1)).toMatchObject({
            isLoggedIn: false,
            isAdmin: false,
            userId: "",
            username: "",
        });
    });
});
