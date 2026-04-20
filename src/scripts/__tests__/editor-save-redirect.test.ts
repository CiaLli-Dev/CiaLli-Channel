import { describe, expect, it } from "vitest";

import {
    ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
    buildArticleDetailSuccessRedirectUrl,
    buildDiaryDetailSuccessRedirectUrl,
    buildDiarySaveSuccessRedirectUrl,
} from "@/scripts/shared/editor-save-redirect";
import {
    appendEditorSaveFreshnessParam,
    EDITOR_SAVE_FRESHNESS_PARAM,
    hasEditorSaveFreshnessParam,
} from "@/utils/editor-save-freshness";

describe("editor save redirect helpers", () => {
    it("文章保存成功后返回文章列表", () => {
        expect(ARTICLE_SAVE_SUCCESS_REDIRECT_URL).toBe("/posts");
        expect(
            appendEditorSaveFreshnessParam(
                ARTICLE_SAVE_SUCCESS_REDIRECT_URL,
                "fixed-token",
            ),
        ).toBe(`/posts?${EDITOR_SAVE_FRESHNESS_PARAM}=fixed-token`);
    });

    it("日记保存成功后返回编码后的用户日记列表", () => {
        expect(buildDiarySaveSuccessRedirectUrl("alice")).toBe("/alice/diary");
        expect(buildDiarySaveSuccessRedirectUrl("空 白")).toBe(
            "/%E7%A9%BA%20%E7%99%BD/diary",
        );
        expect(
            buildDiarySaveSuccessRedirectUrl("alice", {
                fresh: true,
                freshnessToken: "fixed-token",
            }),
        ).toBe(`/alice/diary?${EDITOR_SAVE_FRESHNESS_PARAM}=fixed-token`);
    });

    it("文章发布成功后优先使用 slug 构建详情地址", () => {
        expect(
            buildArticleDetailSuccessRedirectUrl({
                id: "post-id",
                short_id: "short-id",
                slug: "my post",
            }),
        ).toBe("/posts/my%20post");
        expect(
            buildArticleDetailSuccessRedirectUrl(
                {
                    id: "post-id",
                    short_id: "short-id",
                    slug: "my post",
                },
                {
                    fresh: true,
                    freshnessToken: "fixed-token",
                },
            ),
        ).toBe(`/posts/my%20post?${EDITOR_SAVE_FRESHNESS_PARAM}=fixed-token`);
    });

    it("文章详情地址缺少 slug 时回退到 short_id 再回退到 id", () => {
        expect(
            buildArticleDetailSuccessRedirectUrl({
                id: "post-id",
                short_id: "short-id",
            }),
        ).toBe("/posts/short-id");
        expect(buildArticleDetailSuccessRedirectUrl({ id: "post-id" })).toBe(
            "/posts/post-id",
        );
    });

    it("日记详情地址优先使用 short_id，缺少时回退到 id", () => {
        expect(
            buildDiaryDetailSuccessRedirectUrl("空 白", {
                id: "diary-id",
                short_id: "diary short",
            }),
        ).toBe("/%E7%A9%BA%20%E7%99%BD/diary/diary%20short");
        expect(
            buildDiaryDetailSuccessRedirectUrl("alice", { id: "diary-id" }),
        ).toBe("/alice/diary/diary-id");
        expect(
            buildDiaryDetailSuccessRedirectUrl(
                "空 白",
                {
                    id: "diary-id",
                    short_id: "diary short",
                },
                {
                    fresh: true,
                    freshnessToken: "fixed-token",
                },
            ),
        ).toBe(
            `/%E7%A9%BA%20%E7%99%BD/diary/diary%20short?${EDITOR_SAVE_FRESHNESS_PARAM}=fixed-token`,
        );
    });

    it("freshness 参数保留已有 query 和 hash", () => {
        const url = appendEditorSaveFreshnessParam(
            "/posts?tag=astro#comments",
            "fixed-token",
        );

        expect(url).toBe(
            `/posts?tag=astro&${EDITOR_SAVE_FRESHNESS_PARAM}=fixed-token#comments`,
        );
        expect(
            hasEditorSaveFreshnessParam(new URL(`https://example.com${url}`)),
        ).toBe(true);
    });
});
