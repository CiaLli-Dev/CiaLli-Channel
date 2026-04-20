import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const adminSettingsPagePath = fileURLToPath(
    new URL("../../pages/admin/settings.astro", import.meta.url),
);
const adminBulletinPagePath = fileURLToPath(
    new URL("../../pages/admin/bulletin.astro", import.meta.url),
);
const adminAboutPagePath = fileURLToPath(
    new URL("../../pages/admin/about.astro", import.meta.url),
);
const legacyAdminSettingsPagePath = fileURLToPath(
    new URL("../../pages/admin/settings/site.astro", import.meta.url),
);
const legacyAdminBulletinPagePath = fileURLToPath(
    new URL("../../pages/admin/settings/bulletin.astro", import.meta.url),
);
const legacyAdminAboutPagePath = fileURLToPath(
    new URL("../../pages/admin/settings/about.astro", import.meta.url),
);
const layoutScriptPath = fileURLToPath(
    new URL("../layout/index.ts", import.meta.url),
);
const dashboardNavCardsPath = fileURLToPath(
    new URL(
        "../../components/admin/dashboard/DashboardNavCards.astro",
        import.meta.url,
    ),
);
const siteSettingsScriptPath = fileURLToPath(
    new URL("../site-settings/page.ts", import.meta.url),
);
const bulletinScriptPath = fileURLToPath(
    new URL("../admin/bulletin-page.ts", import.meta.url),
);
const aboutScriptPath = fileURLToPath(
    new URL("../admin/about-page.ts", import.meta.url),
);

const layoutScriptSource = readFileSync(layoutScriptPath, "utf8");
const dashboardNavCardsSource = readFileSync(dashboardNavCardsPath, "utf8");
const siteSettingsScriptSource = readFileSync(siteSettingsScriptPath, "utf8");
const bulletinScriptSource = readFileSync(bulletinScriptPath, "utf8");
const aboutScriptSource = readFileSync(aboutScriptPath, "utf8");

describe("admin route migration", () => {
    it("管理页使用新的 Astro 页面路由并移除旧文件", () => {
        expect(existsSync(adminSettingsPagePath)).toBe(true);
        expect(existsSync(adminBulletinPagePath)).toBe(true);
        expect(existsSync(adminAboutPagePath)).toBe(true);

        expect(existsSync(legacyAdminSettingsPagePath)).toBe(false);
        expect(existsSync(legacyAdminBulletinPagePath)).toBe(false);
        expect(existsSync(legacyAdminAboutPagePath)).toBe(false);
    });

    it("layout 只对新管理路径做懒加载分发", () => {
        expect(layoutScriptSource).toContain('path === "/admin/settings"');
        expect(layoutScriptSource).toContain('path === "/admin/bulletin"');
        expect(layoutScriptSource).toContain('path === "/admin/about"');

        expect(layoutScriptSource).not.toContain(
            'path === "/admin/settings/site"',
        );
        expect(layoutScriptSource).not.toContain(
            'path === "/admin/settings/bulletin"',
        );
        expect(layoutScriptSource).not.toContain(
            'path === "/admin/settings/about"',
        );
    });

    it("管理台卡片入口指向新的页面地址", () => {
        expect(dashboardNavCardsSource).toContain('href="/admin/settings"');
        expect(dashboardNavCardsSource).toContain('href="/admin/bulletin"');
        expect(dashboardNavCardsSource).toContain('href="/admin/about"');

        expect(dashboardNavCardsSource).not.toContain(
            'href="/admin/settings/site"',
        );
        expect(dashboardNavCardsSource).not.toContain(
            'href="/admin/settings/bulletin"',
        );
        expect(dashboardNavCardsSource).not.toContain(
            'href="/admin/settings/about"',
        );
    });

    it("页面初始化脚本只接受新的管理页路径", () => {
        expect(siteSettingsScriptSource).toContain('"/admin/settings"');
        expect(siteSettingsScriptSource).not.toContain(
            '"/admin/settings/site"',
        );

        expect(bulletinScriptSource).toContain('"/admin/bulletin"');
        expect(bulletinScriptSource).not.toContain(
            '"/admin/settings/bulletin"',
        );

        expect(aboutScriptSource).toContain('"/admin/about"');
        expect(aboutScriptSource).not.toContain('"/admin/settings/about"');
    });
});
