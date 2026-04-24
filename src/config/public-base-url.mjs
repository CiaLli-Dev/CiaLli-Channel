/**
 * @typedef {{
 *   origin: string;
 *   siteURL: string;
 *   hostname: string;
 *   host: string;
 *   protocol: "http:" | "https:";
 *   port: string;
 * }} ResolvedPublicBaseUrl
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {Record<string, unknown>} env
 * @param {string[]} candidateKeys
 * @returns {string}
 */
function readFirstConfiguredUrl(env, candidateKeys) {
    for (const key of candidateKeys) {
        const candidate = normalizeString(env[key]);
        if (candidate) {
            return candidate;
        }
    }
    return "";
}

/**
 * @param {string} rawValue
 * @param {string} envName
 * @returns {URL}
 */
function parseHttpUrl(rawValue, envName) {
    let parsed;
    try {
        parsed = new URL(rawValue);
    } catch {
        throw new Error(
            `${envName} must be an absolute http(s) URL: ${rawValue}`,
        );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
            `${envName} must use http or https: ${parsed.protocol || rawValue}`,
        );
    }

    return parsed;
}

/**
 * @param {URL} parsed
 * @param {string} rawValue
 * @param {string} envName
 * @returns {void}
 */
function assertRootUrl(parsed, rawValue, envName) {
    if (parsed.username || parsed.password) {
        throw new Error(`${envName} must not include username or password`);
    }

    if (parsed.pathname && parsed.pathname !== "/") {
        throw new Error(
            `${envName} must point to the site root without a path: ${rawValue}`,
        );
    }

    if (parsed.search) {
        throw new Error(`${envName} must not include a query string`);
    }

    if (parsed.hash) {
        throw new Error(`${envName} must not include a hash fragment`);
    }
}

/**
 * @param {URL} parsed
 * @returns {ResolvedPublicBaseUrl}
 */
function buildResolvedPublicBaseUrl(parsed) {
    return {
        origin: parsed.origin,
        siteURL: `${parsed.origin}/`,
        hostname: parsed.hostname,
        host: parsed.host,
        protocol: parsed.protocol,
        port: parsed.port,
    };
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ envName?: string; fallbackKeys?: string[] }} [options]
 * @returns {ResolvedPublicBaseUrl}
 */
export function resolvePublicBaseUrl(env, options = {}) {
    const envName = options.envName || "APP_PUBLIC_BASE_URL";
    const fallbackKeys = options.fallbackKeys || [];
    const candidateKeys = [envName, ...fallbackKeys];
    const rawValue = readFirstConfiguredUrl(env, candidateKeys);

    if (!rawValue) {
        throw new Error(`${envName} is required`);
    }

    const parsed = parseHttpUrl(rawValue, envName);
    assertRootUrl(parsed, rawValue, envName);
    return buildResolvedPublicBaseUrl(parsed);
}
