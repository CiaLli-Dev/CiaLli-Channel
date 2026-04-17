import {
    getAuthState,
    subscribeAuthState,
    type AuthState,
} from "@/scripts/auth/state";

export function isPasswordProtectionOwner(
    ownerUserId: string,
    state: AuthState,
): boolean {
    const normalizedOwnerUserId = String(ownerUserId || "").trim();
    return (
        Boolean(normalizedOwnerUserId) &&
        state.isLoggedIn &&
        Boolean(state.userId) &&
        state.userId === normalizedOwnerUserId
    );
}

export function bindPasswordProtectionOwnerSync(
    ownerUserId: string,
    onChange: (isOwner: boolean) => void,
): () => void {
    const applyState = (state: AuthState): void => {
        onChange(isPasswordProtectionOwner(ownerUserId, state));
    };

    applyState(getAuthState());
    return subscribeAuthState(applyState);
}
