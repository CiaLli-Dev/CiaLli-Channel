export function resolveDiaryDisplayDateSource(
    displayDateOverride: Date | string | null | undefined,
    createdAt: string | null | undefined,
): Date | string | null {
    return displayDateOverride || createdAt || null;
}
