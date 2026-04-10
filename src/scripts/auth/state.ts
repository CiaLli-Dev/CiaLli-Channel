export type AuthState = {
    userId: string;
    username: string;
    isAdmin: boolean;
    isLoggedIn: boolean;
};

const AUTH_STATE_CACHE_KEY = "__cialliAuthState";

function normalizeState(
    input: Partial<AuthState> | null | undefined,
): AuthState {
    return {
        userId: input?.userId ? String(input.userId) : "",
        username: input?.username ? String(input.username) : "",
        isAdmin: Boolean(input?.isAdmin),
        isLoggedIn: Boolean(input?.isLoggedIn),
    };
}

export function getAuthState(): AuthState {
    const raw = (
        window as Window &
            typeof globalThis & {
                [key: string]: Partial<AuthState> | undefined;
            }
    )[AUTH_STATE_CACHE_KEY];
    return normalizeState(raw);
}

export function emitAuthState(
    input: Partial<AuthState> | null | undefined,
): AuthState {
    const state = normalizeState(input);
    (
        window as Window &
            typeof globalThis & {
                [key: string]: AuthState;
            }
    )[AUTH_STATE_CACHE_KEY] = state;

    document.dispatchEvent(
        new CustomEvent("cialli:auth-state", {
            detail: state,
        }),
    );

    return state;
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
