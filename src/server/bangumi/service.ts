import { hashParams } from "@/server/cache/key-utils";
import { cacheManager } from "@/server/cache/manager";
import {
    fetchBangumiCollectionsPage,
    resolveBangumiApiUsernameById,
} from "@/server/bangumi/client";
import { hashBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import type {
    BangumiCollectionItem,
    BangumiCollectionRecord,
    BangumiCollectionStatus,
    BangumiListQuery,
    BangumiListResult,
    BangumiSubject,
} from "@/server/bangumi/types";

const PAGE_SIZE = 50;
const MAX_OFFSET = 20_000;

const STATUS_TO_TYPE: Record<BangumiCollectionStatus, 1 | 2 | 3 | 4 | 5> = {
    planned: 1,
    completed: 2,
    watching: 3,
    onhold: 4,
    dropped: 5,
};

const TYPE_TO_STATUS: Record<1 | 2 | 3 | 4 | 5, BangumiCollectionStatus> = {
    1: "planned",
    2: "completed",
    3: "watching",
    4: "onhold",
    5: "dropped",
};

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function toPositiveInt(value: unknown): number | null {
    const parsed = toNumber(value);
    if (parsed === null) {
        return null;
    }
    if (parsed <= 0) {
        return null;
    }
    return Math.floor(parsed);
}

function pickStatus(typeValue: unknown): BangumiCollectionStatus {
    const parsed = toPositiveInt(typeValue);
    if (
        parsed === 1 ||
        parsed === 2 ||
        parsed === 3 ||
        parsed === 4 ||
        parsed === 5
    ) {
        return TYPE_TO_STATUS[parsed];
    }
    return "planned";
}

function pickCoverUrl(record: BangumiCollectionRecord): string | null {
    const images = record.subject?.images;
    const candidates = [
        images?.common,
        images?.large,
        images?.medium,
        images?.grid,
        images?.small,
    ];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (value) {
            return value;
        }
    }
    return null;
}

function pickGenres(record: BangumiCollectionRecord): string[] {
    const set = new Set<string>();

    if (Array.isArray(record.tags)) {
        for (const tag of record.tags) {
            const value = String(tag || "").trim();
            if (value) {
                set.add(value);
            }
        }
    }

    const subjectTags = record.subject?.tags;
    if (Array.isArray(subjectTags)) {
        for (const tag of subjectTags) {
            const name = String(tag?.name || "").trim();
            if (name) {
                set.add(name);
            }
        }
    }

    return [...set];
}

function resolveSubjectId(
    record: BangumiCollectionRecord,
    subject: BangumiSubject,
): number | null {
    return toPositiveInt(record.subject_id) ?? toPositiveInt(subject.id);
}

function resolveSubjectTitle(subject: BangumiSubject): string | null {
    const fallbackTitle = String(subject.name || "").trim();
    const titleCn = String(subject.name_cn || "").trim();
    return titleCn || fallbackTitle || null;
}

function resolveSubjectYear(subject: BangumiSubject): string | null {
    const dateRaw = String(subject.date || "").trim();
    return /^\d{4}/.test(dateRaw) ? dateRaw.slice(0, 4) : null;
}

function resolveRating(
    record: BangumiCollectionRecord,
    subject: BangumiSubject,
): number | null {
    const userRate = toPositiveInt(record.rate);
    const score = toNumber(subject.score);
    return userRate ?? (score && score > 0 ? score : null);
}

function mapBangumiRecord(
    record: BangumiCollectionRecord,
): BangumiCollectionItem | null {
    const subject = record.subject;
    if (!subject) {
        return null;
    }

    const subjectId = resolveSubjectId(record, subject);
    if (!subjectId) {
        return null;
    }

    const title = resolveSubjectTitle(subject);
    if (!title) {
        return null;
    }

    const titleCn = String(subject.name_cn || "").trim();

    return {
        id: `bgm-${subjectId}`,
        subject_id: subjectId,
        title,
        title_cn: titleCn || null,
        watch_status: pickStatus(record.type),
        rating: resolveRating(record, subject),
        progress: toPositiveInt(record.ep_status),
        total_episodes: toPositiveInt(subject.eps),
        year: resolveSubjectYear(subject),
        studio: null,
        genres: pickGenres(record),
        description: String(subject.short_summary || "").trim() || null,
        link: `https://bgm.tv/subject/${subjectId}`,
        cover_url: pickCoverUrl(record),
        private: Boolean(record.private),
        updated_at: String(record.updated_at || "").trim() || null,
    };
}

async function fetchCollectionsByType(
    username: string,
    type: 1 | 2 | 3 | 4 | 5,
    accessToken?: string | null,
): Promise<BangumiCollectionRecord[]> {
    const records: BangumiCollectionRecord[] = [];
    let offset = 0;

    while (offset <= MAX_OFFSET) {
        const response = await fetchBangumiCollectionsPage({
            username,
            type,
            offset,
            limit: PAGE_SIZE,
            accessToken,
        });

        const rows = Array.isArray(response.data)
            ? response.data.filter(
                  (entry): entry is BangumiCollectionRecord =>
                      Boolean(entry) && typeof entry === "object",
              )
            : [];

        records.push(...rows);

        const total = toPositiveInt(response.total);
        if (
            (total !== null && records.length >= total) ||
            rows.length < PAGE_SIZE
        ) {
            break;
        }

        offset += rows.length;
    }

    return records;
}

async function fetchAllCollections(
    username: string,
    status: BangumiCollectionStatus | undefined,
    accessToken?: string | null,
): Promise<BangumiCollectionRecord[]> {
    const types = status
        ? [STATUS_TO_TYPE[status]]
        : ([1, 2, 3, 4, 5] as Array<1 | 2 | 3 | 4 | 5>);

    const chunks = await Promise.all(
        types.map((type) =>
            fetchCollectionsByType(username, type, accessToken),
        ),
    );

    return chunks.flat();
}

function sortByUpdatedAt(
    items: BangumiCollectionItem[],
): BangumiCollectionItem[] {
    return [...items].sort((a, b) => {
        const aTime = a.updated_at ? Date.parse(a.updated_at) : 0;
        const bTime = b.updated_at ? Date.parse(b.updated_at) : 0;
        return bTime - aTime;
    });
}

/**
 * 优先尝试私有拉取，失败自动降级到公开拉取。
 */
async function fetchWithFallback(
    query: BangumiListQuery,
): Promise<BangumiCollectionRecord[]> {
    const token = String(query.accessToken || "").trim();
    if (query.includePrivate && token) {
        try {
            return await fetchAllCollections(
                query.username,
                query.status,
                token,
            );
        } catch (error) {
            console.warn(
                `[bangumi] private fetch failed for ${query.username}, fallback to public:`,
                String(error),
            );
        }
    }

    try {
        return await fetchAllCollections(query.username, query.status, null);
    } catch (error) {
        console.warn(
            `[bangumi] public fetch failed for ${query.username}:`,
            String(error),
        );
        return [];
    }
}

function buildCacheKey(query: BangumiListQuery): string {
    return hashParams({
        bangumi_id: query.username,
        status: query.status || "all",
        includePrivate: query.includePrivate,
        tokenHash: hashBangumiAccessToken(query.accessToken),
    });
}

function buildResolvedUsernameCacheKey(bangumiId: string): string {
    return hashParams({ bangumi_id: bangumiId, kind: "resolved-username" });
}

/**
 * 先从缓存读取 UID->用户名映射，避免每次都访问 bgm.tv 重定向接口。
 */
async function resolveApiUsernameWithCache(bangumiId: string): Promise<string> {
    const cacheKey = buildResolvedUsernameCacheKey(bangumiId);
    const cached = await cacheManager.get<string>("bangumi-list", cacheKey);
    if (cached) {
        return cached;
    }

    const resolved = await resolveBangumiApiUsernameById(bangumiId).catch(
        (error: unknown) => {
            console.warn(
                `[bangumi] resolve uid failed for ${bangumiId}, fallback to uid:`,
                String(error),
            );
            return bangumiId;
        },
    );

    void cacheManager.set("bangumi-list", cacheKey, resolved);
    return resolved;
}

export async function loadBangumiCollections(
    query: BangumiListQuery,
): Promise<BangumiListResult> {
    const page = query.page > 0 ? Math.floor(query.page) : 1;
    const limit = query.limit > 0 ? Math.min(200, Math.floor(query.limit)) : 20;
    const bangumiId = normalizeBangumiId(query.username);
    if (!bangumiId) {
        return {
            items: [],
            page,
            limit,
            total: 0,
        };
    }

    const cacheKey = buildCacheKey({ ...query, username: bangumiId });
    const cachedItems = await cacheManager.get<BangumiCollectionItem[]>(
        "bangumi-list",
        cacheKey,
    );

    let sortedItems: BangumiCollectionItem[] | null = Array.isArray(cachedItems)
        ? cachedItems
        : null;

    if (!sortedItems) {
        const apiUsername = await resolveApiUsernameWithCache(bangumiId);

        const normalizedQuery: BangumiListQuery = {
            ...query,
            username: apiUsername,
            page,
            limit,
        };

        const records = await fetchWithFallback(normalizedQuery);
        const mapped = records
            .map((record) => mapBangumiRecord(record))
            .filter((item): item is BangumiCollectionItem => Boolean(item));
        sortedItems = sortByUpdatedAt(mapped);
        void cacheManager.set("bangumi-list", cacheKey, sortedItems);
    }

    const offset = (page - 1) * limit;

    const result: BangumiListResult = {
        items: sortedItems.slice(offset, offset + limit),
        page,
        limit,
        total: sortedItems.length,
    };
    return result;
}
