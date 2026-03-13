import type { SiteConfig } from "@/types/config";
import type { ResolvedSiteSettings } from "@/types/site-settings";

const SITE_LOCALE_MAP: Record<SiteConfig["lang"], string> = {
    zh_CN: "zh-CN",
    zh_TW: "zh-TW",
    en: "en-US",
    ja: "ja-JP",
    ko: "ko-KR",
    es: "es-ES",
    th: "th-TH",
    vi: "vi-VN",
    tr: "tr-TR",
    id: "id-ID",
};

const FALLBACK_LOCALE = "en-US";
const FALLBACK_TIME_ZONE = "UTC";

export const SITE_TIME_ZONE_AUTO_VALUE = "__site_auto_timezone__";

type SiteDateInput = Date | string | null | undefined;

export type SiteDateFormatContext = {
    locale: string;
    timeZone: string;
};

export function formatDateToYYYYMMDD(date: Date): string {
    return date.toISOString().substring(0, 10);
}

function toValidDate(input: SiteDateInput): Date | null {
    if (input instanceof Date) {
        return Number.isNaN(input.getTime()) ? null : input;
    }
    const normalized = String(input || "").trim();
    if (!normalized) {
        return null;
    }
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function readDateTimePart(
    input: Date,
    context: SiteDateFormatContext,
    options: Intl.DateTimeFormatOptions,
    targetType: Intl.DateTimeFormatPartTypes,
): string {
    const formatter = new Intl.DateTimeFormat(context.locale, {
        timeZone: context.timeZone,
        ...options,
    });
    const matched = formatter
        .formatToParts(input)
        .find((part) => part.type === targetType);
    return matched?.value || "";
}

function readTimeParts(
    input: Date,
    context: SiteDateFormatContext,
): { hour: string; minute: string } {
    const formatter = new Intl.DateTimeFormat(context.locale, {
        timeZone: context.timeZone,
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
    });
    const parts = formatter.formatToParts(input);
    return {
        hour: parts.find((part) => part.type === "hour")?.value || "",
        minute: parts.find((part) => part.type === "minute")?.value || "",
    };
}

export function resolveSiteLocale(lang: string | null | undefined): string {
    const normalized = String(lang || "").trim() as SiteConfig["lang"];
    return SITE_LOCALE_MAP[normalized] || FALLBACK_LOCALE;
}

/**
 * 统一校验并规范化 IANA 时区；`UTC` 额外视为合法显式值。
 */
export function canonicalizeSiteTimeZone(
    value: string | null | undefined,
): string | null {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return null;
    }
    if (normalized.toUpperCase() === "UTC") {
        return "UTC";
    }
    try {
        const resolved = new Intl.DateTimeFormat(FALLBACK_LOCALE, {
            timeZone: normalized,
        }).resolvedOptions().timeZone;
        return String(resolved || normalized).trim() || null;
    } catch {
        return null;
    }
}

export function resolveEnvironmentTimeZone(): string {
    const resolved = canonicalizeSiteTimeZone(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return resolved || FALLBACK_TIME_ZONE;
}

export function resolveEffectiveSiteTimeZone(
    configuredTimeZone: string | null | undefined,
): string {
    return (
        canonicalizeSiteTimeZone(configuredTimeZone) ||
        resolveEnvironmentTimeZone()
    );
}

export function getSupportedSiteTimeZones(): string[] {
    if (typeof Intl.supportedValuesOf !== "function") {
        return [];
    }
    try {
        return Intl.supportedValuesOf("timeZone").filter(Boolean);
    } catch {
        return [];
    }
}

export function buildSiteDateFormatContext(
    resolvedSiteSettings: ResolvedSiteSettings | null | undefined,
): SiteDateFormatContext {
    return {
        locale: resolveSiteLocale(resolvedSiteSettings?.system.lang),
        timeZone: resolveEffectiveSiteTimeZone(
            resolvedSiteSettings?.system.timeZone,
        ),
    };
}

export function formatDateI18n(
    dateString: string,
    lang: string | null | undefined = "en",
): string {
    const date = toValidDate(dateString);
    if (!date) {
        return "";
    }
    const locale = resolveSiteLocale(lang);
    const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "long",
        day: "numeric",
    };
    return date.toLocaleDateString(locale, options);
}

export function formatSiteDate(
    input: SiteDateInput,
    context: SiteDateFormatContext,
): string {
    const date = toValidDate(input);
    if (!date) {
        return "";
    }
    const year = readDateTimePart(date, context, { year: "numeric" }, "year");
    const month = readDateTimePart(
        date,
        context,
        { month: "2-digit" },
        "month",
    );
    const day = readDateTimePart(date, context, { day: "2-digit" }, "day");
    if (!year || !month || !day) {
        return "";
    }
    return `${year}/${month}/${day}`;
}

export function formatSiteDateTime(
    input: SiteDateInput,
    context: SiteDateFormatContext,
): string {
    const date = toValidDate(input);
    if (!date) {
        return "";
    }
    const datePart = formatSiteDate(date, context);
    const { hour, minute } = readTimeParts(date, context);
    if (!datePart || !hour || !minute) {
        return "";
    }
    return `${datePart} · ${hour}:${minute}`;
}

export function formatSiteMonthDay(
    input: SiteDateInput,
    context: SiteDateFormatContext,
): string {
    const date = toValidDate(input);
    if (!date) {
        return "";
    }
    return new Intl.DateTimeFormat(context.locale, {
        timeZone: context.timeZone,
        month: "short",
        day: "numeric",
    }).format(date);
}
