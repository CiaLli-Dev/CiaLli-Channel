import { describe, expect, it } from "vitest";

import {
    mixHomeFeedCandidates,
    scoreHomeFeedCandidates,
} from "@/server/recommendation/home-feed";
import type {
    HomeFeedCandidate,
    HomeFeedDiaryEntry,
    HomeFeedItemType,
} from "@/server/recommendation/home-feed.types";
import type { AppDiaryImage } from "@/types/app";
import type { DirectusPostEntry } from "@/utils/content-utils";

const BASE_NOW = new Date("2026-02-19T12:00:00.000Z");

type CandidateInput = {
    id: string;
    type: HomeFeedItemType;
    authorId: string;
    hoursAgo: number;
    likes72h?: number;
    comments72h?: number;
    qualityScore?: number;
    personalizationScore?: number;
};

function createDiaryImages(diaryId: string, count: number): AppDiaryImage[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `${diaryId}-image-${index}`,
        status: "published",
        diary_id: diaryId,
        file_id: `file-${diaryId}-${index}`,
        image_url: null,
        caption: null,
        is_public: true,
        show_on_profile: true,
        sort: index,
        date_created: BASE_NOW.toISOString(),
        date_updated: BASE_NOW.toISOString(),
    }));
}

function createArticleEntry(
    id: string,
    authorId: string,
    publishedAt: Date,
): DirectusPostEntry {
    return {
        id,
        slug: null,
        body: "这是一个用于测试的文章正文。".repeat(60),
        url: `/posts/${id}`,
        data: {
            article_id: id,
            author_id: authorId,
            author: {
                id: authorId,
                name: authorId,
                display_name: authorId,
                username: authorId,
            },
            title: `文章-${id}`,
            description: "测试摘要",
            image: "https://example.com/cover.jpg",
            tags: ["推荐", "测试"],
            category: "tech",
            comment_count: 0,
            like_count: 0,
            published: publishedAt,
            updated: publishedAt,
        },
    };
}

function createDiaryEntry(
    id: string,
    authorId: string,
    publishedAt: Date,
): HomeFeedDiaryEntry {
    return {
        id,
        short_id: id,
        author_id: authorId,
        status: "published",
        content: "这是一个用于测试的日记正文。".repeat(30),
        allow_comments: true,
        praviate: true,
        date_created: publishedAt.toISOString(),
        date_updated: publishedAt.toISOString(),
        author: {
            id: authorId,
            name: authorId,
            display_name: authorId,
            username: authorId,
        },
        images: createDiaryImages(id, 2),
        comment_count: 0,
        like_count: 0,
    };
}

function createCandidate(input: CandidateInput): HomeFeedCandidate {
    const publishedAt = new Date(
        BASE_NOW.getTime() - input.hoursAgo * 60 * 60 * 1000,
    );
    const likes72h = input.likes72h ?? 0;
    const comments72h = input.comments72h ?? 0;
    const qualityScore = input.qualityScore ?? 0.6;
    const personalizationScore = input.personalizationScore ?? 0;

    if (input.type === "article") {
        return {
            type: "article",
            id: input.id,
            authorId: input.authorId,
            publishedAt,
            entry: createArticleEntry(input.id, input.authorId, publishedAt),
            likes72h,
            comments72h,
            qualityScore,
            personalizationScore,
        };
    }

    return {
        type: "diary",
        id: input.id,
        authorId: input.authorId,
        publishedAt,
        entry: createDiaryEntry(input.id, input.authorId, publishedAt),
        likes72h,
        comments72h,
        qualityScore,
        personalizationScore,
    };
}

function buildAuthorCooldownCandidates(): HomeFeedCandidate[] {
    return [
        createCandidate({
            id: "article-a1",
            type: "article",
            authorId: "author-a",
            hoursAgo: 1,
            likes72h: 40,
            comments72h: 20,
        }),
        createCandidate({
            id: "article-a2",
            type: "article",
            authorId: "author-a",
            hoursAgo: 2,
            likes72h: 36,
            comments72h: 18,
        }),
        createCandidate({
            id: "article-b1",
            type: "article",
            authorId: "author-b",
            hoursAgo: 3,
            likes72h: 35,
            comments72h: 16,
        }),
        createCandidate({
            id: "article-c1",
            type: "article",
            authorId: "author-c",
            hoursAgo: 4,
            likes72h: 34,
            comments72h: 14,
        }),
        createCandidate({
            id: "diary-d1",
            type: "diary",
            authorId: "author-d",
            hoursAgo: 2,
            likes72h: 26,
            comments72h: 12,
        }),
        createCandidate({
            id: "diary-e1",
            type: "diary",
            authorId: "author-e",
            hoursAgo: 5,
            likes72h: 24,
            comments72h: 10,
        }),
        createCandidate({
            id: "diary-f1",
            type: "diary",
            authorId: "author-f",
            hoursAgo: 6,
            likes72h: 22,
            comments72h: 9,
        }),
    ];
}

describe("home feed recommendation", () => {
    it("在互动相同条件下，新内容应排在旧内容之前", () => {
        const candidates = [
            createCandidate({
                id: "article-old",
                type: "article",
                authorId: "author-a",
                hoursAgo: 72,
            }),
            createCandidate({
                id: "article-new",
                type: "article",
                authorId: "author-b",
                hoursAgo: 1,
            }),
        ];

        const ranked = scoreHomeFeedCandidates(candidates, {
            now: BASE_NOW,
            isLoggedIn: false,
        });

        expect(ranked[0]?.id).toBe("article-new");
    });

    it("同新鲜度下，72h 互动更高的内容应前移", () => {
        const candidates = [
            createCandidate({
                id: "article-low",
                type: "article",
                authorId: "author-a",
                hoursAgo: 12,
                likes72h: 0,
                comments72h: 0,
            }),
            createCandidate({
                id: "article-high",
                type: "article",
                authorId: "author-b",
                hoursAgo: 12,
                likes72h: 50,
                comments72h: 30,
            }),
        ];

        const ranked = scoreHomeFeedCandidates(candidates, {
            now: BASE_NOW,
            isLoggedIn: false,
        });

        expect(ranked[0]?.id).toBe("article-high");
    });

    it("候选充足时，混排结果接近 6:4（文章:日记）", () => {
        const articleCandidates = Array.from({ length: 30 }, (_, index) =>
            createCandidate({
                id: `article-${index}`,
                type: "article",
                authorId: `author-a-${index}`,
                hoursAgo: 1 + index,
                likes72h: 20 - Math.floor(index / 2),
                comments72h: 10 - Math.floor(index / 3),
            }),
        );
        const diaryCandidates = Array.from({ length: 20 }, (_, index) =>
            createCandidate({
                id: `diary-${index}`,
                type: "diary",
                authorId: `author-d-${index}`,
                hoursAgo: 2 + index,
                likes72h: 18 - Math.floor(index / 2),
                comments72h: 8 - Math.floor(index / 3),
            }),
        );

        const ranked = scoreHomeFeedCandidates(
            [...articleCandidates, ...diaryCandidates],
            {
                now: BASE_NOW,
                isLoggedIn: false,
            },
        );
        const mixed = mixHomeFeedCandidates(ranked, 50);

        const articleCount = mixed.filter(
            (item) => item.type === "article",
        ).length;
        const diaryCount = mixed.filter((item) => item.type === "diary").length;

        expect(articleCount).toBe(30);
        expect(diaryCount).toBe(20);
    });

    it("候选允许时，同作者冷却应生效（最近 2 条不重复）", () => {
        const candidates = buildAuthorCooldownCandidates();

        const ranked = scoreHomeFeedCandidates(candidates, {
            now: BASE_NOW,
            isLoggedIn: false,
        });
        const mixed = mixHomeFeedCandidates(ranked, 6);

        for (let index = 1; index < mixed.length; index += 1) {
            const lookback = mixed
                .slice(Math.max(0, index - 2), index)
                .map((item) => item.authorId);
            expect(lookback).not.toContain(mixed[index].authorId);
        }
    });

    it("登录态下偏好命中会提升排名", () => {
        const candidates = [
            createCandidate({
                id: "article-normal",
                type: "article",
                authorId: "author-a",
                hoursAgo: 4,
                likes72h: 8,
                comments72h: 4,
                qualityScore: 0.6,
                personalizationScore: 0,
            }),
            createCandidate({
                id: "article-pref",
                type: "article",
                authorId: "author-b",
                hoursAgo: 4,
                likes72h: 8,
                comments72h: 4,
                qualityScore: 0.6,
                personalizationScore: 1,
            }),
        ];

        const ranked = scoreHomeFeedCandidates(candidates, {
            now: BASE_NOW,
            isLoggedIn: true,
        });

        expect(ranked[0]?.id).toBe("article-pref");
    });

    it("当一类内容为空时可平稳退化输出", () => {
        const onlyArticles = Array.from({ length: 8 }, (_, index) =>
            createCandidate({
                id: `article-only-${index}`,
                type: "article",
                authorId: `author-${index}`,
                hoursAgo: 1 + index,
                likes72h: 10 - Math.floor(index / 2),
                comments72h: 6 - Math.floor(index / 3),
            }),
        );

        const ranked = scoreHomeFeedCandidates(onlyArticles, {
            now: BASE_NOW,
            isLoggedIn: false,
        });
        const mixed = mixHomeFeedCandidates(ranked, 6);

        expect(mixed).toHaveLength(6);
        expect(mixed.every((item) => item.type === "article")).toBe(true);
    });
});
