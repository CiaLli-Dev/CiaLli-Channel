import { readOptionalRuntimeEnv } from "@/server/env/runtime";

const UUID_SOURCE =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const UUID_PATTERN = new RegExp(UUID_SOURCE, "i");
const RELATIVE_PUBLIC_ASSET_PATTERN = new RegExp(
    `(?:https?:\\/\\/[^\\s"'()\\]]+)?\\/api\\/v1\\/public\\/assets\\/(${UUID_SOURCE})(?=[/?#)"'\\]\\s]|$)`,
    "gi",
);
const RELATIVE_PRIVATE_ASSET_PATTERN = new RegExp(
    `(?:https?:\\/\\/[^\\s"'()\\]]+)?\\/api\\/v1\\/assets\\/(${UUID_SOURCE})(?=[/?#)"'\\]\\s]|$)`,
    "gi",
);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toUuidCandidates(value: string): string[] {
    const hits = value.match(new RegExp(UUID_SOURCE, "gi")) || [];
    return hits.map((item: string) => item.toLowerCase());
}

function buildExternalPublicAssetPattern(): RegExp | null {
    const rawBaseUrl = readOptionalRuntimeEnv("PUBLIC_ASSET_BASE_URL") || "";
    if (!rawBaseUrl) {
        return null;
    }

    try {
        const origin = new URL(rawBaseUrl).origin;
        return new RegExp(
            `${escapeRegExp(origin)}\\/(${UUID_SOURCE})(?=[/?#)"'\\]\\s]|$)`,
            "gi",
        );
    } catch {
        return null;
    }
}

function collectAssetIdsFromString(value: string, output: Set<string>): void {
    const patterns = [
        RELATIVE_PUBLIC_ASSET_PATTERN,
        RELATIVE_PRIVATE_ASSET_PATTERN,
        buildExternalPublicAssetPattern(),
    ].filter((pattern): pattern is RegExp => pattern instanceof RegExp);

    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match = pattern.exec(value);
        while (match) {
            const fileId = normalizeDirectusFileId(match[1]);
            if (fileId) {
                output.add(fileId);
            }
            match = pattern.exec(value);
        }
    }
}

export function toUniqueFileIds(values: unknown[]): string[] {
    const set = new Set<string>();
    for (const value of values) {
        const fileId = normalizeDirectusFileId(value);
        if (fileId) {
            set.add(fileId);
        }
    }
    return [...set];
}

export function extractDirectusAssetIdsFromMarkdown(
    value: string | null | undefined,
): string[] {
    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    const found = new Set<string>();
    // 仅接受项目生成的资源 URL，避免把正文里的普通 UUID 误判成文件引用。
    collectAssetIdsFromString(value, found);
    return [...found];
}

export function normalizeDirectusFileId(value: unknown): string | null {
    if (!value) {
        return null;
    }
    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw || !UUID_PATTERN.test(raw)) {
            return null;
        }
        const candidates = toUuidCandidates(raw);
        return candidates[0] || null;
    }
    if (typeof value === "object") {
        const record = value as { id?: unknown };
        if (typeof record.id === "string") {
            return normalizeDirectusFileId(record.id);
        }
    }
    return null;
}
