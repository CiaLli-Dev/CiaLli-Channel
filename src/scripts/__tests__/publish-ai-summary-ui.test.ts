import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const publishSettingsOverlayPath = fileURLToPath(
    new URL(
        "../../components/publish/PublishSettingsOverlay.astro",
        import.meta.url,
    ),
);
const publishPageDomPath = fileURLToPath(
    new URL("../publish/page-dom.ts", import.meta.url),
);
const publishPageSubmitPath = fileURLToPath(
    new URL("../publish/page-submit.ts", import.meta.url),
);
const articleDetailPagePath = fileURLToPath(
    new URL("../../pages/posts/[id].astro", import.meta.url),
);

describe("publish AI summary UI", () => {
    it("保存弹层提供 AI 总结开关并进入提交 payload", () => {
        const overlaySource = readFileSync(publishSettingsOverlayPath, "utf8");
        const domSource = readFileSync(publishPageDomPath, "utf8");
        const submitSource = readFileSync(publishPageSubmitPath, "utf8");

        expect(overlaySource).toContain("publish-article-ai-summary-enabled");
        expect(overlaySource).toContain("articleEditorAiSummaryEnabled");
        expect(domSource).toContain("articleAiSummaryEnabledInput");
        expect(submitSource).toContain("ai_summary_enabled");
    });

    it("文章详情页仅将 AI 来源摘要渲染为彩虹边框卡片", () => {
        const detailSource = readFileSync(articleDetailPagePath, "utf8");

        expect(detailSource).toContain("summary_source");
        expect(detailSource).toContain("article-ai-summary-card");
        expect(detailSource).toContain('summary_source === "ai"');
    });
});
