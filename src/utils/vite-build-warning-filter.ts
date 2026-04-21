const VITE_RESOLVE_PLUGIN_NAME = "vite:resolve";
const BROWSER_COMPATIBILITY_WARNING_TEXT =
    "has been externalized for browser compatibility";

const KNOWN_BROWSER_COMPATIBILITY_IMPORTER_SEGMENTS = [
    "/node_modules/@astrojs/node/",
    "/node_modules/@astrojs/internal-helpers/",
    "/node_modules/@rollup/pluginutils/",
    "/node_modules/esbuild/",
    "/node_modules/glob/",
    "/node_modules/resolve-from/",
    "/node_modules/bindings/",
    "/node_modules/@mapbox/node-pre-gyp/",
    "/node_modules/graceful-fs/",
    "/node_modules/nopt/",
    "/node_modules/detect-libc/",
    "/node_modules/file-uri-to-path/",
    "/node_modules/async-sema/",
    "/node_modules/node-gyp-build/",
] as const;

type BuildWarningLike = {
    message: string;
    plugin?: string;
};

function normalizePathSeparators(value: string): string {
    return value.replace(/\\/g, "/");
}

function extractWarningImporter(message: string): string | null {
    const matched = /imported by "([^"]+)"/.exec(message);
    if (!matched || !matched[1]) {
        return null;
    }

    return normalizePathSeparators(matched[1]);
}

function isKnownDynamicImportConflictWarning(
    warning: BuildWarningLike,
): boolean {
    return (
        warning.message.includes("is dynamically imported by") &&
        warning.message.includes("but also statically imported by")
    );
}

/**
 * 这些 warning 来自 Astro/Vercel/NFT 构建链对 server-only 依赖的浏览器侧解析噪音，
 * 已确认不会泄漏到客户端产物，因此仅按精确白名单收敛。
 */
export function isKnownBrowserCompatibilityNoise(
    warning: BuildWarningLike,
): boolean {
    if (
        warning.plugin !== VITE_RESOLVE_PLUGIN_NAME ||
        !warning.message.includes(BROWSER_COMPATIBILITY_WARNING_TEXT)
    ) {
        return false;
    }

    const importer = extractWarningImporter(warning.message);
    if (!importer || !importer.includes("/node_modules/")) {
        return false;
    }

    return KNOWN_BROWSER_COMPATIBILITY_IMPORTER_SEGMENTS.some((segment) =>
        importer.includes(segment),
    );
}

export function shouldIgnoreBuildWarning(warning: BuildWarningLike): boolean {
    return (
        isKnownDynamicImportConflictWarning(warning) ||
        isKnownBrowserCompatibilityNoise(warning)
    );
}
