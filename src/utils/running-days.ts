export const FALLBACK_SITE_START_DATE = "2025-01-01";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isValidDateParts(year: number, month: number, day: number): boolean {
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day)
    ) {
        return false;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return false;
    }

    const candidate = new Date(year, month - 1, day);
    return (
        candidate.getFullYear() === year &&
        candidate.getMonth() === month - 1 &&
        candidate.getDate() === day
    );
}

function normalizeToDateStart(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 解析建站日期文本，并统一归一化为本地自然日的 00:00:00。
 * 这样可以避免日期字符串在不同时区下产生偏移。
 */
export function parseSiteStartDate(
    dateText: string | null | undefined,
): Date | null {
    const normalized = String(dateText ?? "").trim();
    if (!normalized) {
        return null;
    }

    const dateOnlyMatch = DATE_ONLY_PATTERN.exec(normalized);
    if (dateOnlyMatch) {
        const [, yearText, monthText, dayText] = dateOnlyMatch;
        const year = Number.parseInt(yearText, 10);
        const month = Number.parseInt(monthText, 10);
        const day = Number.parseInt(dayText, 10);
        if (!isValidDateParts(year, month, day)) {
            return null;
        }
        return new Date(year, month - 1, day);
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return normalizeToDateStart(parsed);
}

/**
 * 计算站点运行天数（按自然日差值），未来日期会被钳制为 0。
 */
export function getRunningDays(
    siteStartDate: string | null | undefined,
    now: Date = new Date(),
): number {
    const resolvedStartDate =
        parseSiteStartDate(siteStartDate) ??
        parseSiteStartDate(FALLBACK_SITE_START_DATE);
    if (!resolvedStartDate) {
        return 0;
    }

    const normalizedNow = normalizeToDateStart(now);
    const diffDays = Math.floor(
        (normalizedNow.getTime() - resolvedStartDate.getTime()) / MS_PER_DAY,
    );
    return Math.max(0, diffDays);
}
