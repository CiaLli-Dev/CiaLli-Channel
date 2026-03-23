import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
    HomeFeedCandidate,
    HomeFeedPreferenceProfile,
} from "@/server/recommendation/home-feed.types";
import type { DirectusPostEntry } from "@/utils/content-utils";

vi.mock("@/server/cache/manager", () => ({
    cacheManager: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
    },
}));

vi.mock("@/server/directus/client", () => ({
    runWithDirectusServiceAccess: vi.fn(
        async (fn: () => Promise<unknown>) => await fn(),
    ),
}));

vi.mock("@/server/recommendation/home-feed-pool", () => ({
    hydrateHomeFeedResult: vi.fn((value: unknown) => value),
    loadHomeFeedCandidatePool: vi.fn(),
    loadPreferenceProfile: vi.fn(),
    pickCandidateByType: vi.fn(
        (
            articleQueue: HomeFeedCandidate[],
            diaryQueue: HomeFeedCandidate[],
            expectedType: "article" | "diary",
        ) => {
            if (expectedType === "article") {
                return articleQueue.shift() || diaryQueue.shift() || null;
            }
            return diaryQueue.shift() || articleQueue.shift() || null;
        },
    ),
}));

import {
    loadHomeFeedCandidatePool,
    loadPreferenceProfile,
} from "@/server/recommendation/home-feed-pool";
import { buildHomeFeed } from "@/server/recommendation/home-feed";

const mockedLoadHomeFeedCandidatePool = vi.mocked(loadHomeFeedCandidatePool);
const mockedLoadPreferenceProfile = vi.mocked(loadPreferenceProfile);

function createArticleCandidate(id: string): HomeFeedCandidate {
    const publishedAt = new Date("2026-02-19T12:00:00.000Z");
    const entry: DirectusPostEntry = {
        id,
        slug: null,
        body: "feed body",
        url: `/posts/${id}`,
        data: {
            article_id: id,
            author_id: "author-1",
            author: {
                id: "author-1",
                name: "author-1",
                display_name: "author-1",
                username: "author-1",
            },
            title: `文章-${id}`,
            description: "摘要",
            image: undefined,
            tags: ["tag"],
            category: "tech",
            comment_count: 0,
            like_count: 0,
            published: publishedAt,
            updated: publishedAt,
        },
    };
    return {
        type: "article",
        id,
        authorId: "author-1",
        publishedAt,
        entry,
        likes72h: 0,
        comments72h: 0,
        qualityScore: 0.5,
        personalizationScore: 0,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadPreferenceProfile.mockResolvedValue({
        authorWeights: new Map(),
        tagWeights: new Map(),
        categoryWeights: new Map(),
    } satisfies HomeFeedPreferenceProfile);
});

describe("home feed draft visibility", () => {
    it("登录用户首页不再额外插入 owner draft", async () => {
        mockedLoadHomeFeedCandidatePool.mockResolvedValue({
            generatedAt: "2026-02-19T12:00:00.000Z",
            articleCandidateCount: 1,
            diaryCandidateCount: 0,
            candidates: [createArticleCandidate("article-public-1")],
        });

        const result = await buildHomeFeed({
            viewerId: "owner-1",
            limit: 5,
            now: new Date("2026-02-19T12:00:00.000Z"),
        });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.id).toBe("article-public-1");
    });
});
