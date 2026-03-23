import { describe, expect, it } from "vitest";

import {
    articleFilters,
    diaryFilters,
} from "@/server/api/v1/public-data-helpers";

describe("public-data content filters", () => {
    it("owner 视角文章区也只返回 published", () => {
        expect(articleFilters(true)).toEqual([
            { status: { _eq: "published" } },
            {
                _or: [
                    { slug: { _null: true } },
                    { slug: { _nin: ["about", "friends"] } },
                ],
            },
        ]);
    });

    it("owner 视角日记区也只返回 published", () => {
        expect(diaryFilters(true)).toEqual([{ status: { _eq: "published" } }]);
    });

    it("访客视角仍保留公开内容过滤", () => {
        expect(diaryFilters(false)).toEqual([
            { status: { _eq: "published" } },
            { praviate: { _eq: true } },
        ]);
    });
});
