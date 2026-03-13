import {
    weightedCharLength,
    charWeight,
    USERNAME_MAX_WEIGHT,
    DISPLAY_NAME_MAX_WEIGHT,
} from "@/constants/text-limits";
import { badRequest } from "@/server/api/errors";

const USERNAME_ALLOWED_PATTERN = /^[A-Za-z0-9_-]+$/;

function trimUsernameEdges(value: string): string {
    return value.replace(/^[-_]+|[-_]+$/g, "");
}

export function truncateUsernameByWeight(
    value: string,
    maxWeight: number,
): string {
    if (maxWeight <= 0) {
        return "";
    }
    let total = 0;
    let output = "";
    for (const ch of value) {
        const w = charWeight(ch);
        if (total + w > maxWeight) {
            break;
        }
        output += ch;
        total += w;
    }
    return output;
}

function normalizeRequestedUsernameBase(input: string): string {
    return String(input || "").trim();
}

function normalizeAutoUsernameBase(input: string): string {
    return normalizeRequestedUsernameBase(input).toLowerCase();
}

export function normalizeRequestedUsername(input: string): string {
    const normalized = normalizeRequestedUsernameBase(input);
    if (!normalized) {
        throw badRequest("USERNAME_EMPTY", "用户名不能为空");
    }
    if (!USERNAME_ALLOWED_PATTERN.test(normalized)) {
        throw badRequest(
            "USERNAME_INVALID",
            "用户名仅支持英文、数字、下划线和短横线",
        );
    }
    if (weightedCharLength(normalized) > USERNAME_MAX_WEIGHT) {
        throw badRequest("USERNAME_TOO_LONG", "用户名最多 14 字符");
    }
    return normalized;
}

export function normalizeAutoUsername(input: string): string {
    const normalized = trimUsernameEdges(
        normalizeAutoUsernameBase(input)
            .replace(/\s+/g, "-")
            .replace(/[^A-Za-z0-9_-]/g, "-")
            .replace(/-+/g, "-"),
    );
    const fallback = normalized || "user";
    const truncated = truncateUsernameByWeight(fallback, USERNAME_MAX_WEIGHT);
    return truncated || "user";
}

export function composeUsernameWithSuffix(
    base: string,
    suffix: string,
): string {
    if (!suffix) {
        return truncateUsernameByWeight(base, USERNAME_MAX_WEIGHT);
    }
    const suffixWeight = weightedCharLength(suffix);
    const baseBudget = Math.max(1, USERNAME_MAX_WEIGHT - suffixWeight);
    const trimmedBase = trimUsernameEdges(
        truncateUsernameByWeight(base, baseBudget),
    );
    return `${trimmedBase || "u"}${suffix}`;
}

// eslint-disable-next-line no-control-regex
const DISPLAY_NAME_INVALID_PATTERN = /[\x00-\x1F\x7F]/;

export function validateDisplayName(input: string): string {
    const value = String(input || "").trim();
    if (!value) {
        throw badRequest("DISPLAY_NAME_EMPTY", "昵称不能为空");
    }
    if (DISPLAY_NAME_INVALID_PATTERN.test(value)) {
        throw badRequest("DISPLAY_NAME_INVALID", "昵称包含非法字符");
    }
    if (weightedCharLength(value) > DISPLAY_NAME_MAX_WEIGHT) {
        throw badRequest("DISPLAY_NAME_TOO_LONG", "昵称最多 20 字符");
    }
    return value;
}
