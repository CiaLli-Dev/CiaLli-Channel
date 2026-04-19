const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

export function readRuntimeEnv(name: string): string {
    return String(process.env[name] || "").trim();
}

export function readOptionalRuntimeEnv(name: string): string | null {
    const value = readRuntimeEnv(name);
    return value || null;
}

export function readBooleanRuntimeEnv(name: string): boolean {
    return TRUTHY_ENV_VALUES.has(readRuntimeEnv(name).toLowerCase());
}

export function isProductionRuntime(): boolean {
    return readRuntimeEnv("NODE_ENV").toLowerCase() === "production";
}
