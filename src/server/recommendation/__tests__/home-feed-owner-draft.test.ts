import { describe, expect, it } from "vitest";

import {
    prependOwnerDraftToHomeFeed,
    scoreHomeFeedCandidates,
} from "@/server/recommendation/home-feed";
import type {
    HomeFeedArticleCandidate,
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
        body: "测试正文",
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
            image: undefined,
            tags: ["测试"],
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
        content: "测试日记",
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
        images: createDiaryImages(id, 1),
        comment_count: 0,
        like_count: 0,
    };
}

function createCandidate(input: CandidateInput): HomeFeedCandidate {
    const publishedAt = new Date(
        BASE_NOW.getTime() - input.hoursAgo * 60 * 60 * 1000,
    );
    const base = {
        id: input.id,
        authorId: input.authorId,
        publishedAt,
        likes72h: input.likes72h ?? 0,
        comments72h: input.comments72h ?? 0,
        qualityScore: input.qualityScore ?? 0.6,
        personalizationScore: input.personalizationScore ?? 0,
    };

    if (input.type === "article") {
        return {
            type: "article",
            ...base,
            entry: createArticleEntry(input.id, input.authorId, publishedAt),
        };
    }

    return {
        type: "diary",
        ...base,
        entry: createDiaryEntry(input.id, input.authorId, publishedAt),
    };
}

describe("home feed owner draft", () => {
    it("将 owner draft 固定放在首页首位并限制长度", () => {
        const ranked = scoreHomeFeedCandidates(
            [
                createCandidate({
                    id: "article-public-1",
                    type: "article",
                    authorId: "author-a",
                    hoursAgo: 1,
                    likes72h: 10,
                }),
                createCandidate({
                    id: "diary-public-1",
                    type: "diary",
                    authorId: "author-b",
                    hoursAgo: 2,
                    likes72h: 5,
                }),
            ],
            {
                now: BASE_NOW,
                isLoggedIn: true,
            },
        );
        const ownerDraft = createCandidate({
            id: "owner-draft",
            type: "article",
            authorId: "owner-1",
            hoursAgo: 0,
        });

        const merged = prependOwnerDraftToHomeFeed(
            ranked,
            ownerDraft as HomeFeedArticleCandidate,
            2,
        );

        expect(merged).toHaveLength(2);
        expect(merged[0]?.id).toBe("owner-draft");
        expect(merged.some((item) => item.id === "article-public-1")).toBe(
            true,
        );
    });

    it("相同 id 不会重复插入", () => {
        const ranked = scoreHomeFeedCandidates(
            [
                createCandidate({
                    id: "owner-draft",
                    type: "article",
                    authorId: "owner-1",
                    hoursAgo: 1,
                }),
            ],
            {
                now: BASE_NOW,
                isLoggedIn: true,
            },
        );
        const ownerDraft = createCandidate({
            id: "owner-draft",
            type: "article",
            authorId: "owner-1",
            hoursAgo: 0,
        });

        const merged = prependOwnerDraftToHomeFeed(
            ranked,
            ownerDraft as HomeFeedArticleCandidate,
            3,
        );

        expect(merged.filter((item) => item.id === "owner-draft")).toHaveLength(
            1,
        );
        expect(merged[0]?.id).toBe("owner-draft");
    });
});
