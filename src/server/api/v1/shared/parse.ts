import type { AppStatus, CommentStatus, SocialLink } from "@/types/app";
import type { JsonObject, JsonValue } from "@/types/json";
import {
    weightedCharLength,
    PROFILE_BIO_MAX_LENGTH,
} from "@/constants/text-limits";
import { badRequest } from "@/server/api/errors";
import {
    toBooleanValue,
    toNumberValue,
    toOptionalString,
    toStringValue,
} from "@/server/api/utils";

import { hasOwn } from "./helpers";
import { normalizeCommentStatus, normalizeStatus } from "./normalize";

export function parseRouteId(input: string | undefined): string {
    return (input || "").trim();
}

export function parseBodyTextField(body: JsonObject, key: string): string {
    return toStringValue(body[key]).trim();
}

export function parseProfileBioField(
    input: JsonValue | undefined,
): string | null {
    const value = toOptionalString(input);
    if (!value) {
        return null;
    }
    if (weightedCharLength(value) > PROFILE_BIO_MAX_LENGTH) {
        throw badRequest("PROFILE_BIO_TOO_LONG", "个人简介最多 30 字符");
    }
    return value;
}

export function parseProfileTypewriterSpeedField(
    input: JsonValue | undefined,
    fallback = 80,
): number {
    const value = toNumberValue(input, fallback) ?? fallback;
    return Math.max(10, Math.min(500, Math.floor(value)));
}

const SOCIAL_LINKS_MAX = 20;
const SOCIAL_LINK_URL_MAX_LENGTH = 500;

export function parseSocialLinks(
    input: JsonValue | undefined,
): SocialLink[] | null {
    if (input === null || input === undefined) {
        return null;
    }
    if (!Array.isArray(input)) {
        throw badRequest("SOCIAL_LINKS_INVALID", "社交链接格式不正确");
    }
    if (input.length > SOCIAL_LINKS_MAX) {
        throw badRequest("SOCIAL_LINKS_TOO_MANY", "社交链接最多 20 条");
    }
    const result: SocialLink[] = [];
    for (const item of input) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw badRequest("SOCIAL_LINKS_INVALID", "社交链接格式不正确");
        }
        const record = item as Record<string, unknown>;
        const platform = String(record.platform || "").trim();
        const url = String(record.url || "").trim();
        if (!platform || !url) {
            continue;
        }
        if (url.length > SOCIAL_LINK_URL_MAX_LENGTH) {
            throw badRequest("SOCIAL_LINKS_INVALID", "社交链接格式不正确");
        }
        const enabled =
            record.enabled === undefined ? true : Boolean(record.enabled);
        result.push({ platform, url, enabled });
    }
    return result;
}

export function parseBodyStatus(
    body: JsonObject,
    key: string,
    fallback: AppStatus,
): AppStatus {
    return normalizeStatus(parseBodyTextField(body, key), fallback);
}

export function parseBodyCommentStatus(
    body: JsonObject,
    key: string,
    fallback: CommentStatus,
): CommentStatus {
    return normalizeCommentStatus(parseBodyTextField(body, key), fallback);
}

export function parseVisibilityPatch(body: JsonObject): JsonObject {
    const payload: JsonObject = {};
    if (hasOwn(body, "status")) {
        payload.status = normalizeStatus(
            parseBodyTextField(body, "status"),
            "draft",
        );
    }
    if (hasOwn(body, "is_public")) {
        payload.is_public = toBooleanValue(body.is_public, true);
    }
    if (hasOwn(body, "show_on_profile")) {
        payload.show_on_profile = toBooleanValue(body.show_on_profile, true);
    }
    return payload;
}
