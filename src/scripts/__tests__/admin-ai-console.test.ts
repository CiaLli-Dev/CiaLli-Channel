import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AdminKey } from "@/i18n/keys/admin";
import { enAdmin } from "@/i18n/languages/parts/en/admin";
import { jaAdmin } from "@/i18n/languages/parts/ja/admin";
import { zhCNAdmin } from "@/i18n/languages/parts/zh_CN/admin";
import { zhTWAdmin } from "@/i18n/languages/parts/zh_TW/admin";

const dashboardNavCardsPath = fileURLToPath(
    new URL(
        "../../components/admin/dashboard/DashboardNavCards.astro",
        import.meta.url,
    ),
);
const adminAiPagePath = fileURLToPath(
    new URL("../../pages/admin/ai.astro", import.meta.url),
);

const dashboardNavCardsSource = readFileSync(dashboardNavCardsPath, "utf8");
const adminTranslations = [zhCNAdmin, zhTWAdmin, enAdmin, jaAdmin];

describe("admin AI console UI", () => {
    it("管理控制台在顶部提供 AI 入口卡片", () => {
        const hrefMatches = Array.from(
            dashboardNavCardsSource.matchAll(/href="([^"]+)"/gu),
            (match) => match[1],
        );

        expect(hrefMatches[0]).toBe("/admin/ai");
        expect(dashboardNavCardsSource).toContain("admin-dashboard-ai-card");
        expect(dashboardNavCardsSource).toContain("adminDashboardAiTitle");
        expect(dashboardNavCardsSource).toContain(
            "adminDashboardAiDescription",
        );
        expect(dashboardNavCardsSource).not.toContain("box-shadow:");
    });

    it("存在独立的 AI 管理页并接入真实保存接口", () => {
        expect(existsSync(adminAiPagePath)).toBe(true);

        const adminAiPageSource = readFileSync(adminAiPagePath, "utf8");

        expect(adminAiPageSource).toContain("AdminLayout");
        expect(adminAiPageSource).toContain("adminAiPageTitle");
        expect(adminAiPageSource).toContain("/api/v1/admin/ai/settings");
        expect(adminAiPageSource).toContain("adminAiApiKeyConfigured");
        expect(adminAiPageSource).toContain("adminAiClearApiKey");
        expect(adminAiPageSource).not.toContain("/api/v1/admin/settings/site");
    });

    it("AI 管理台文案 key 在管理台多语言中齐备", () => {
        const requiredKeys = [
            AdminKey.adminDashboardAiTitle,
            AdminKey.adminDashboardAiDescription,
            AdminKey.adminAiPageTitle,
            AdminKey.adminAiPageDescription,
            AdminKey.adminAiPageIntro,
            AdminKey.adminAiSectionOverview,
            AdminKey.adminAiSectionConnection,
            AdminKey.adminAiSectionFeatures,
            AdminKey.adminAiSectionAutomation,
            AdminKey.adminAiComingSoon,
            AdminKey.adminAiSaveSettings,
            AdminKey.adminAiClearApiKey,
            AdminKey.adminAiApiKeyConfigured,
            AdminKey.adminAiApiKeyMissing,
        ];

        for (const translations of adminTranslations) {
            for (const key of requiredKeys) {
                expect(translations[key]).toBeTruthy();
            }
        }
    });
});
