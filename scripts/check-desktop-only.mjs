import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve(process.cwd(), "src");

const rules = [
    {
        name: "Tailwind 响应式前缀 sm:/md:",
        regex: /(?:^|[\s"'`])(?:sm|md):[A-Za-z0-9_()[\]/.%:-]+/gm,
    },
    {
        name: "@media (max-width...) 语句",
        regex: /@media\s*\(\s*max-width/gm,
    },
    {
        name: 'matchMedia("(max-width...) 调用',
        regex: /matchMedia\(\s*["'`]\s*\(max-width/gm,
    },
    {
        name: "移动端变量分支 isMobile/isTablet",
        regex: /\bisMobile\b|\bisTablet\b/gm,
    },
    {
        name: "旧侧边栏 drawer 配置",
        regex: /\bsidebarLayout\.components\.drawer\b|\bcomponents\.drawer\b|\bdrawer\s*:/gm,
    },
    {
        name: "旧 Banner 移动端字段",
        regex: /\bbanner\.src\.mobile\b|\bmobileDisable\b/gm,
    },
    {
        name: "旧移动导航面板标识",
        regex: /\bnav-menu-panel\b|\bmobile-toc-panel\b/gm,
    },
];

async function walkFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const targetPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walkFiles(targetPath)));
            continue;
        }
        files.push(targetPath);
    }
    return files;
}

function getLineColumn(content, index) {
    const upToIndex = content.slice(0, index);
    const lines = upToIndex.split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return { line, column };
}

function collectMatches(content, regex) {
    const matches = [];
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
        if (typeof match.index !== "number") {
            continue;
        }
        matches.push({ index: match.index, value: match[0] });
    }
    return matches;
}

const files = await walkFiles(sourceRoot);
const violations = [];

for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    for (const rule of rules) {
        const matches = collectMatches(content, rule.regex);
        for (const match of matches) {
            const { line, column } = getLineColumn(content, match.index);
            violations.push({
                filePath,
                line,
                column,
                rule: rule.name,
                snippet: match.value.trim(),
            });
        }
    }
}

if (violations.length === 0) {
    console.log("[desktop-only-check] passed");
    process.exit(0);
}

console.error("[desktop-only-check] found unsupported responsive remnants:");
for (const violation of violations) {
    const relativePath = path.relative(process.cwd(), violation.filePath);
    console.error(
        `- ${relativePath}:${violation.line}:${violation.column} [${violation.rule}] ${violation.snippet}`,
    );
}
process.exit(1);
