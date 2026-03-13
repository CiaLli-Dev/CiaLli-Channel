export type OwnerArticleIdentity = {
    id?: string | null;
    shortId?: string | null;
    slug?: string | null;
};

function normalizeStorageFragment(value: string | null | undefined): string {
    return String(value || "").trim();
}

export function buildOwnerArticlePasswordStorageKeys(
    identity: OwnerArticleIdentity,
): string[] {
    const keys = new Set<string>();
    const id = normalizeStorageFragment(identity.id);
    const shortId = normalizeStorageFragment(identity.shortId);
    const slug = normalizeStorageFragment(identity.slug);

    if (id) {
        keys.add(`owner-article-password:id:${id}`);
    }
    if (shortId) {
        keys.add(`owner-article-password:short:${shortId}`);
    }
    if (slug) {
        keys.add(`owner-article-password:slug:${slug}`);
    }

    return Array.from(keys);
}
