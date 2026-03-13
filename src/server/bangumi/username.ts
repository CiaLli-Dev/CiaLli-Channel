/**
 * 归一化 Bangumi ID：仅允许纯数字字符串。
 */
export function normalizeBangumiId(input: string | null | undefined): string {
    const value = String(input || "").trim();
    if (!value) {
        return "";
    }
    return /^[0-9]+$/.test(value) ? value : "";
}
