type ProtectedContentPasswordCacheGlobal = typeof globalThis & {
    __protectedContentPasswordCache?: Map<string, string>;
};

function getProtectedContentPasswordCache(): Map<string, string> {
    const runtimeGlobal = globalThis as ProtectedContentPasswordCacheGlobal;
    if (!runtimeGlobal.__protectedContentPasswordCache) {
        runtimeGlobal.__protectedContentPasswordCache = new Map<
            string,
            string
        >();
    }
    return runtimeGlobal.__protectedContentPasswordCache;
}

function normalizeCacheKey(key: string): string {
    return String(key || "").trim();
}

function normalizePassword(password: string): string {
    return String(password || "").trim();
}

export function readCachedProtectedContentPassword(key: string): string {
    const normalizedKey = normalizeCacheKey(key);
    if (!normalizedKey) {
        return "";
    }
    const cachedPassword =
        getProtectedContentPasswordCache().get(normalizedKey) || "";
    return normalizePassword(cachedPassword);
}

export function readCachedProtectedContentPasswords(keys: string[]): string[] {
    const passwords = new Set<string>();
    for (const key of keys) {
        const password = readCachedProtectedContentPassword(key);
        if (password) {
            passwords.add(password);
        }
    }
    return Array.from(passwords);
}

export function writeCachedProtectedContentPassword(
    key: string,
    password: string,
): void {
    const normalizedKey = normalizeCacheKey(key);
    const normalizedPassword = normalizePassword(password);
    if (!normalizedKey || !normalizedPassword) {
        return;
    }
    getProtectedContentPasswordCache().set(normalizedKey, normalizedPassword);
}

export function writeCachedProtectedContentPasswords(
    keys: string[],
    password: string,
): void {
    for (const key of keys) {
        writeCachedProtectedContentPassword(key, password);
    }
}

export function clearCachedProtectedContentPassword(key: string): void {
    const normalizedKey = normalizeCacheKey(key);
    if (!normalizedKey) {
        return;
    }
    getProtectedContentPasswordCache().delete(normalizedKey);
}

export function clearCachedProtectedContentPasswords(keys: string[]): void {
    for (const key of keys) {
        clearCachedProtectedContentPassword(key);
    }
}

export function resetProtectedContentPasswordCache(): void {
    getProtectedContentPasswordCache().clear();
}
