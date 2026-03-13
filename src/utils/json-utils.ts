import type { JsonArray, JsonObject, JsonValue } from "@/types/json";

export function isJsonObject(value: JsonValue): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: JsonValue): value is JsonArray {
    return Array.isArray(value);
}

export function getJsonString(
    object: JsonObject,
    key: string,
): string | undefined {
    const value = object[key];
    return typeof value === "string" ? value : undefined;
}

export function getJsonNumber(
    object: JsonObject,
    key: string,
): number | undefined {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

export function getJsonStringArray(object: JsonObject, key: string): string[] {
    const value = object[key];
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((entry): entry is string => typeof entry === "string");
}
