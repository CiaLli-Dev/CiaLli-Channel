import { describe, expect, it } from "vitest";

import { AdminBulletinPreviewSchema } from "@/server/api/schemas/admin";
import { ArticlePreviewSchema } from "@/server/api/schemas/article";
import { CommentPreviewSchema } from "@/server/api/schemas/comment";
import { DiaryPreviewSchema } from "@/server/api/schemas/diary";

describe("Preview Schema render_mode", () => {
    it("article preview 默认 full", () => {
        const parsed = ArticlePreviewSchema.parse({ body_markdown: "# title" });
        expect(parsed.render_mode).toBe("full");
    });

    it("diary preview 支持 fast", () => {
        const parsed = DiaryPreviewSchema.parse({
            content: "hello",
            render_mode: "fast",
        });
        expect(parsed.render_mode).toBe("fast");
    });

    it("comment preview 支持 full", () => {
        const parsed = CommentPreviewSchema.parse({
            body: "comment",
            render_mode: "full",
        });
        expect(parsed.render_mode).toBe("full");
    });

    it("admin bulletin preview 默认 full", () => {
        const parsed = AdminBulletinPreviewSchema.parse({
            body_markdown: "公告",
        });
        expect(parsed.render_mode).toBe("full");
    });
});
