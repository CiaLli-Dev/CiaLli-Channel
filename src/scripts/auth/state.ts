export type AuthState = {
    userId: string;
    username: string;
    isAdmin: boolean;
    isLoggedIn: boolean;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
};

const AUTH_STATE_CACHE_KEY = "__cialliAuthState";
const API_ME = "/api/auth/me?optional=1";

type AuthMePayload = {
    ok?: unknown;
    isAdmin?: unknown;
    is_admin?: unknown;
    user?: {
        id?: unknown;
        username?: unknown;
        name?: unknown;
        email?: unknown;
        avatarUrl?: unknown;
    };
};

type RefreshAuthStateOptions = {
    force?: boolean;
};

let refreshTask: Promise<AuthState> | null = null;
let refreshSequence = 0;
let latestStartedRefresh = 0;

function toCleanString(value: unknown): string {
    return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeState(
    input: Partial<AuthState> | null | undefined,
): AuthState {
    const isLoggedIn = Boolean(input?.isLoggedIn);
    return {
        userId: input?.userId ? String(input.userId) : "",
        username: input?.username ? String(input.username) : "",
        isAdmin: Boolean(isLoggedIn && input?.isAdmin),
        isLoggedIn,
        displayName: input?.displayName ? String(input.displayName) : "",
        email: input?.email ? String(input.email) : "",
        avatarUrl: input?.avatarUrl ? String(input.avatarUrl) : "",
    };
}

function getAuthStateStore(): Window &
    typeof globalThis & {
        [AUTH_STATE_CACHE_KEY]?: Partial<AuthState>;
    } {
    return window as Window &
        typeof globalThis & {
            [AUTH_STATE_CACHE_KEY]?: Partial<AuthState>;
        };
}

function authStateFromPayload(payload: AuthMePayload): AuthState {
    const user = payload.user;
    const userId = toCleanString(user?.id);
    const username = toCleanString(user?.username);
    const displayName = toCleanString(user?.name);
    const email = toCleanString(user?.email);
    const avatarUrl = toCleanString(user?.avatarUrl);
    const isLoggedIn = Boolean(userId);
    return normalizeState({
        isLoggedIn,
        isAdmin: Boolean(isLoggedIn && (payload.is_admin ?? payload.isAdmin)),
        userId,
        username,
        displayName,
        email,
        avatarUrl,
    });
}

function loggedOutState(): AuthState {
    return normalizeState({
        isLoggedIn: false,
        isAdmin: false,
        userId: "",
        username: "",
    });
}

function shouldApplyRefreshResult(requestId: number): boolean {
    return requestId === latestStartedRefresh;
}

export function getAuthState(): AuthState {
    const raw = getAuthStateStore()[AUTH_STATE_CACHE_KEY];
    return normalizeState(raw);
}

export function emitAuthState(
    input: Partial<AuthState> | null | undefined,
): AuthState {
    const state = normalizeState(input);
    getAuthStateStore()[AUTH_STATE_CACHE_KEY] = state;

    document.dispatchEvent(
        new CustomEvent("cialli:auth-state", {
            detail: state,
        }),
    );

    return state;
}

async function fetchAuthState(requestId: number): Promise<AuthState> {
    try {
        const response = await fetch(API_ME, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            cache: "no-store",
        });
        const data = (await response
            .json()
            .catch(() => null)) as AuthMePayload | null;

        if (!shouldApplyRefreshResult(requestId)) {
            return getAuthState();
        }

        if (response.ok && data?.ok) {
            return emitAuthState(authStateFromPayload(data));
        }

        if (response.status === 401 || (response.ok && data?.ok === false)) {
            return emitAuthState(loggedOutState());
        }
    } catch (error) {
        console.warn("[auth/state] failed to refresh auth state:", error);
    }

    return getAuthState();
}

export function refreshAuthState(
    options: RefreshAuthStateOptions = {},
): Promise<AuthState> {
    if (refreshTask && !options.force) {
        return refreshTask;
    }

    const requestId = refreshSequence + 1;
    refreshSequence = requestId;
    latestStartedRefresh = requestId;

    const task = fetchAuthState(requestId);
    refreshTask = task;
    void task.finally(() => {
        if (refreshTask === task) {
            refreshTask = null;
        }
    });
    return task;
}

export function subscribeAuthState(
    handler: (state: AuthState) => void,
): () => void {
    const listener = (event: Event) => {
        if (!(event instanceof CustomEvent)) {
            return;
        }
        handler(
            normalizeState((event as CustomEvent<Partial<AuthState>>).detail),
        );
    };
    document.addEventListener("cialli:auth-state", listener);
    return () => {
        document.removeEventListener("cialli:auth-state", listener);
    };
}
