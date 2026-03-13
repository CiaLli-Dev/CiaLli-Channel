type RequiredEnvName =
    | "DIRECTUS_URL"
    | "DIRECTUS_STATIC_TOKEN"
    | "BANGUMI_TOKEN_ENCRYPTION_KEY";

const REQUIRED_ENV_KEYS: RequiredEnvName[] = [
    "DIRECTUS_URL",
    "DIRECTUS_STATIC_TOKEN",
    "BANGUMI_TOKEN_ENCRYPTION_KEY",
];

let cachedError: Error | null = null;
let checked = false;

function getEnvValue(name: RequiredEnvName): string {
    const value = process.env[name] || import.meta.env[name] || "";
    return String(value || "").trim();
}

export function assertRequiredEnv(): void {
    if (checked) {
        if (cachedError) {
            throw cachedError;
        }
        return;
    }

    const missing = REQUIRED_ENV_KEYS.filter((name) => !getEnvValue(name));
    checked = true;
    if (missing.length > 0) {
        cachedError = new Error(`MISSING_REQUIRED_ENV:${missing.join(",")}`);
        throw cachedError;
    }
}
