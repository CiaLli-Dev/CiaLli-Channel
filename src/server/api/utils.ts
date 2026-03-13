import type { JsonObject, JsonValue } from "@/types/json";
import { badRequest } from "@/server/api/errors";
import { isJsonObject } from "@/utils/json-utils";

export function parsePagination(url: URL): {
    page: number;
    limit: number;
    offset: number;
} {
    const pageRaw = Number(url.searchParams.get("page") || "1");
    const limitRaw = Number(url.searchParams.get("limit") || "20");
    const page =
        Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
            ? Math.min(100, Math.floor(limitRaw))
            : 20;
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

export async function parseJsonBody(request: Request): Promise<JsonObject> {
    let payload: JsonValue;
    try {
        payload = (await request.json()) as JsonValue;
    } catch {
        throw badRequest("INVALID_JSON", "请求体不是合法 JSON");
    }
    if (!isJsonObject(payload)) {
        throw badRequest("INVALID_JSON_OBJECT", "请求体必须是 JSON 对象");
    }
    return payload;
}

export function toStringValue(value: JsonValue | undefined): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return "";
}

export function toOptionalString(value: JsonValue | undefined): string | null {
    const s = toStringValue(value).trim();
    return s ? s : null;
}

export function toBooleanValue(
    value: JsonValue | undefined,
    fallback = false,
): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(lowered)) {
            return true;
        }
        if (["0", "false", "no", "off"].includes(lowered)) {
            return false;
        }
    }
    return fallback;
}

export function toNumberValue(
    value: JsonValue | undefined,
    fallback: number | null = null,
): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

export function toStringArray(value: JsonValue | undefined): string[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [];
}
