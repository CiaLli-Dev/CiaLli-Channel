import type { SiteThemePreset, ThemeColorConfig } from "@/types/config";

export type SiteThemePresetOption = {
    id: SiteThemePreset;
    seedHex: string;
    hue: number;
};

export const DEFAULT_SITE_THEME_PRESET: SiteThemePreset = "blue";

const SITE_THEME_PRESET_SEED_HEX: Record<SiteThemePreset, string> = {
    blue: "#0061A4",
    purple: "#6750A4",
    teal: "#006A60",
    orange: "#8C4A00",
};

function normalizeSeedHex(seedHex: string): string {
    const trimmed = seedHex.trim();
    if (/^#[0-9a-f]{6}$/iu.test(trimmed)) {
        return trimmed.toUpperCase();
    }
    throw new Error(`Invalid theme seed hex: ${seedHex}`);
}

function resolveHueFromSeedHex(seedHex: string): number {
    const normalized = normalizeSeedHex(seedHex);
    const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
    const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;

    if (delta === 0) {
        return 0;
    }

    const hue =
        max === red
            ? ((green - blue) / delta) % 6
            : max === green
              ? (blue - red) / delta + 2
              : (red - green) / delta + 4;

    // 现有样式系统以 --hue 作为单轴驱动，这里将 MD3 种子色统一桥接为色相角度。
    return Math.round((hue * 60 + 360) % 360);
}

const SITE_THEME_PRESET_HUE: Record<SiteThemePreset, number> = {
    blue: resolveHueFromSeedHex(SITE_THEME_PRESET_SEED_HEX.blue),
    purple: resolveHueFromSeedHex(SITE_THEME_PRESET_SEED_HEX.purple),
    teal: resolveHueFromSeedHex(SITE_THEME_PRESET_SEED_HEX.teal),
    orange: resolveHueFromSeedHex(SITE_THEME_PRESET_SEED_HEX.orange),
};

export const SITE_THEME_PRESET_OPTIONS: SiteThemePresetOption[] = [
    {
        id: "blue",
        seedHex: SITE_THEME_PRESET_SEED_HEX.blue,
        hue: SITE_THEME_PRESET_HUE.blue,
    },
    {
        id: "purple",
        seedHex: SITE_THEME_PRESET_SEED_HEX.purple,
        hue: SITE_THEME_PRESET_HUE.purple,
    },
    {
        id: "teal",
        seedHex: SITE_THEME_PRESET_SEED_HEX.teal,
        hue: SITE_THEME_PRESET_HUE.teal,
    },
    {
        id: "orange",
        seedHex: SITE_THEME_PRESET_SEED_HEX.orange,
        hue: SITE_THEME_PRESET_HUE.orange,
    },
];

export function isSiteThemePreset(value: unknown): value is SiteThemePreset {
    return (
        typeof value === "string" &&
        (value === "blue" ||
            value === "purple" ||
            value === "teal" ||
            value === "orange")
    );
}

export function resolveSiteThemePreset(value: unknown): SiteThemePreset {
    return isSiteThemePreset(value) ? value : DEFAULT_SITE_THEME_PRESET;
}

export function resolveThemeColorFromPreset(
    preset: SiteThemePreset,
): ThemeColorConfig {
    return {
        hue: SITE_THEME_PRESET_HUE[preset],
    };
}
