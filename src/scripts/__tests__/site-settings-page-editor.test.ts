import { describe, expect, it } from "vitest";

import { normalizeBannerEditorList } from "@/scripts/site-settings/page-editor";

describe("normalizeBannerEditorList", () => {
    it("忽略空字符串横幅占位", () => {
        expect(normalizeBannerEditorList("")).toEqual([]);
        expect(normalizeBannerEditorList("   ")).toEqual([]);
    });

    it("会裁剪并过滤数组中的空值", () => {
        expect(
            normalizeBannerEditorList([
                " /banner-a.jpg ",
                "",
                "   ",
                "/banner-b.jpg",
                null,
            ]),
        ).toEqual(["/banner-a.jpg", "/banner-b.jpg"]);
    });
});
