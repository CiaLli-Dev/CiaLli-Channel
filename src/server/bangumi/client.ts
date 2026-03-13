import type { BangumiCollectionsResponse } from "@/server/bangumi/types";
import { normalizeBangumiId } from "@/server/bangumi/username";

const BANGUMI_API_BASE = "https://api.bgm.tv/v0";
const BANGUMI_WEB_BASE = "https://bgm.tv";
const BANGUMI_USER_AGENT = "DaCapo/1.0 (+https://bangumi.tv/)";
const resolvedUserMap = new Map<string, string>();

export type FetchBangumiCollectionsPageInput = {
    username: string;
    type?: 1 | 2 | 3 | 4 | 5;
    offset: number;
    limit: number;
    accessToken?: string | null;
};

function buildCollectionsUrl(input: FetchBangumiCollectionsPageInput): string {
    const limit = Math.max(1, Math.min(50, Math.floor(input.limit)));
    const offset = Math.max(0, Math.floor(input.offset));
    const params = new URLSearchParams({
        subject_type: "2",
        offset: String(offset),
        limit: String(limit),
    });
    if (input.type) {
        params.set("type", String(input.type));
    }
    return `${BANGUMI_API_BASE}/users/${encodeURIComponent(input.username)}/collections?${params.toString()}`;
}

export async function fetchBangumiCollectionsPage(
    input: FetchBangumiCollectionsPageInput,
): Promise<BangumiCollectionsResponse> {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": BANGUMI_USER_AGENT,
    };
    const token = String(input.accessToken || "").trim();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(buildCollectionsUrl(input), {
        method: "GET",
        headers,
    });

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
            `[bangumi] request failed: ${response.status} ${response.statusText} ${bodyText}`,
        );
    }

    const json = (await response.json()) as BangumiCollectionsResponse;
    return json;
}

function extractUserSlugFromUrl(urlText: string): string | null {
    try {
        const url = new URL(urlText);
        const segments = url.pathname
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean);
        if (segments[0] !== "user" || !segments[1]) {
            return null;
        }
        return decodeURIComponent(segments[1]).trim() || null;
    } catch {
        return null;
    }
}

/**
 * 通过 Bangumi 个人主页重定向把纯数字 UID 解析为 API 可用用户名。
 * 官方 OpenAPI 明确说明：用户设置用户名后无法直接使用 UID 调用 /users/{username}。
 */
export async function resolveBangumiApiUsernameById(
    bangumiIdInput: string,
): Promise<string> {
    const bangumiId = normalizeBangumiId(bangumiIdInput);
    if (!bangumiId) {
        throw new Error("Invalid bangumi id");
    }

    const cached = resolvedUserMap.get(bangumiId);
    if (cached) {
        return cached;
    }

    const response = await fetch(
        `${BANGUMI_WEB_BASE}/user/${encodeURIComponent(bangumiId)}`,
        {
            method: "GET",
            redirect: "follow",
            headers: {
                Accept: "text/html",
                "User-Agent": BANGUMI_USER_AGENT,
            },
        },
    );
    if (!response.ok) {
        throw new Error(
            `[bangumi] resolve user failed: ${response.status} ${response.statusText}`,
        );
    }

    const resolved = extractUserSlugFromUrl(response.url) || bangumiId;
    resolvedUserMap.set(bangumiId, resolved);
    return resolved;
}
