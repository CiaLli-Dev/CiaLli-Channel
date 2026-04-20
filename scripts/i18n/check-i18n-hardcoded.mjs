#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();

/**
 * 先覆盖本轮已完成 i18n 改造的文件，避免误报阻断。
 * 后续批次改造完成后，再逐步扩展该清单。
 */
const CHECK_FILES = [
    "src/pages/[username]/albums/new.astro",
    "src/pages/[username]/diary/new.astro",
    "src/pages/[username]/diary/[id]/edit.astro",
    "src/pages/[username]/diary/[id].astro",
    "src/pages/[username]/albums.astro",
    "src/pages/[username]/albums/[id].astro",
    "src/pages/[username]/index.astro",
    "src/pages/[username]/diary.astro",
    "src/pages/[username]/bangumi.astro",
    "src/pages/[...page].astro",
    "src/pages/posts/[id].astro",
    "src/pages/auth/login.astro",
    "src/pages/api/auth/login.ts",
    "src/pages/api/auth/logout.ts",
    "src/pages/api/auth/me.ts",
    "src/middleware.ts",
    "src/scripts/dialogs.ts",
    "src/scripts/post-interactions.ts",
    "src/scripts/album-new-page.ts",
    "src/pages/me/index.astro",
    "src/pages/me/homepage.astro",
    "src/pages/admin/index.astro",
    "src/pages/admin/users/index.astro",
    "src/pages/admin/settings/about.astro",
    "src/pages/admin/settings/bulletin.astro",
    "src/pages/admin/settings/site.astro",
    "src/pages/auth/register.astro",
    "src/scripts/me-page.ts",
    "src/scripts/me-homepage-page.ts",
    "src/scripts/admin-users-page.ts",
    "src/scripts/admin-about-page.ts",
    "src/scripts/admin-bulletin-page.ts",
    "src/scripts/image-crop-modal.ts",
    "src/scripts/site-settings-page.ts",
    "src/scripts/publish-page.ts",
    "src/scripts/diary-editor-page.ts",
];

const CJK_REGEX = /[\u4e00-\u9fff]/;
const QUOTED_CJK_REGEX =
    /(["'`])(?:\\.|(?!\1)[\s\S])*[\u4e00-\u9fff](?:\\.|(?!\1)[\s\S])*\1/;
const FIXED_EN_FALLBACK_REGEX = /\bCopy Link\b/;

function shouldSkipLine(line) {
    const trimmed = line.trim();
    return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("<!--") ||
        trimmed.startsWith("{/*") ||
        trimmed.includes("console.error(") ||
        trimmed.includes("console.warn(") ||
        trimmed.includes(".includes(")
    );
}

function scanFile(filePath) {
    const absPath = path.join(WORKSPACE_ROOT, filePath);
    if (!fs.existsSync(absPath)) {
        return [];
    }
    const content = fs.readFileSync(absPath, "utf8");
    const lines = content.split(/\r?\n/);
    const issues = [];

    lines.forEach((line, index) => {
        if (shouldSkipLine(line)) {
            return;
        }
        if (
            QUOTED_CJK_REGEX.test(line) ||
            (FIXED_EN_FALLBACK_REGEX.test(line) &&
                !line.includes("I18nKey.") &&
                !line.includes("i18n("))
        ) {
            issues.push({
                file: filePath,
                line: index + 1,
                text: line.trim(),
            });
        }
        // 防止误检：非引号内的 CJK（常见于注释外模板文字）若不含 i18n 也提示
        if (
            CJK_REGEX.test(line) &&
            !line.includes("I18nKey.") &&
            !line.includes("i18n(") &&
            /(title=|placeholder=|aria-label=|textContent\s*=|message:|label:|confirmText:|cancelText:)/.test(
                line,
            )
        ) {
            issues.push({
                file: filePath,
                line: index + 1,
                text: line.trim(),
            });
        }
    });

    return issues;
}

const allIssues = CHECK_FILES.flatMap((file) => scanFile(file));

if (allIssues.length > 0) {
    console.error("[i18n-check] Found hardcoded copy in migrated files:");
    allIssues.forEach((issue) => {
        console.error(`- ${issue.file}:${issue.line} ${issue.text}`);
    });
    process.exit(1);
}

console.log("[i18n-check] passed");
