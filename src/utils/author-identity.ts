export type AuthorIdentitySource = {
    id?: string | null;
    name?: string | null;
    username?: string | null;
    display_name?: string | null;
};

function cleanHandle(value: string | null | undefined): string {
    return String(value || "")
        .trim()
        .replace(/^@+/, "");
}

export function resolveAuthorIdentity(
    source: AuthorIdentitySource | null | undefined,
    fallbackId?: string | null,
): {
    displayName: string;
    username: string;
} {
    const username =
        cleanHandle(source?.username) ||
        cleanHandle(source?.id) ||
        cleanHandle(fallbackId) ||
        "user";
    const displayName =
        String(source?.display_name || "").trim() ||
        String(source?.name || "").trim() ||
        username;

    return {
        displayName,
        username,
    };
}
