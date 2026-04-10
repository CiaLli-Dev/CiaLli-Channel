export function normalizeTagList(tags: string[]): string[] {
    const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
    return Array.from(new Set(normalized));
}

export function normalizeAuthorHandle(value: string): string {
    return value.trim().replace(/^@+/, "").toLowerCase();
}

export function cleanAuthorHandle(value: string): string {
    return value.trim().replace(/^@+/, "");
}
