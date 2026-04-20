#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();

const DOMAIN_FILES = [
    { domain: "core", file: "core.ts" },
    { domain: "content", file: "content.ts" },
    { domain: "auth", file: "auth.ts" },
    { domain: "me", file: "me.ts" },
    { domain: "admin", file: "admin.ts" },
    { domain: "article-editor", file: "article-editor.ts" },
    { domain: "diary-editor", file: "diary-editor.ts" },
    { domain: "interaction", file: "interaction.ts" },
];

const LANGUAGES = ["en", "ja", "zh_CN", "zh_TW"];

function readText(relativePath) {
    return fs.readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8");
}

function parseEnumKeys(content) {
    const keys = [];
    const keyRegex = /^\s*([A-Za-z0-9_]+)\s*=\s*"[A-Za-z0-9_]+"\s*,?\s*$/gm;
    let match = keyRegex.exec(content);
    while (match) {
        keys.push(match[1]);
        match = keyRegex.exec(content);
    }
    return keys;
}

function parsePartKeys(content) {
    const keys = [];
    const keyRegex = /\[Key\.([A-Za-z0-9_]+)\]/g;
    let match = keyRegex.exec(content);
    while (match) {
        keys.push(match[1]);
        match = keyRegex.exec(content);
    }
    return keys;
}

function setDifference(sourceSet, targetSet) {
    return [...sourceSet].filter((item) => !targetSet.has(item));
}

function main() {
    const errors = [];

    const keyDomainMap = new Map();
    const allKeySet = new Set();

    for (const { domain, file } of DOMAIN_FILES) {
        const relativePath = `src/i18n/keys/${file}`;
        if (!fs.existsSync(path.join(WORKSPACE_ROOT, relativePath))) {
            errors.push(`缺少 key 域文件：${relativePath}`);
            continue;
        }

        const keys = parseEnumKeys(readText(relativePath));
        if (keys.length === 0) {
            errors.push(`key 域文件为空：${relativePath}`);
            continue;
        }

        const localSet = new Set();
        for (const key of keys) {
            if (localSet.has(key)) {
                errors.push(`域文件内出现重复 key：${relativePath} -> ${key}`);
                continue;
            }
            localSet.add(key);

            if (allKeySet.has(key)) {
                errors.push(`不同域出现重复 key：${key}`);
                continue;
            }
            allKeySet.add(key);
            keyDomainMap.set(key, domain);
        }
    }

    const partsDir = path.join(WORKSPACE_ROOT, "src/i18n/languages/parts");
    if (!fs.existsSync(partsDir)) {
        errors.push("缺少语言分片目录：src/i18n/languages/parts");
    } else {
        const partFiles = fs.readdirSync(partsDir);
        const legacyPartFiles = partFiles.filter((name) =>
            /\.part\d+\.ts$/.test(name),
        );
        if (legacyPartFiles.length > 0) {
            errors.push(`检测到遗留 part 分片：${legacyPartFiles.join(", ")}`);
        }
    }

    for (const lang of LANGUAGES) {
        const langKeySet = new Set();

        for (const { domain } of DOMAIN_FILES) {
            const partFile = `src/i18n/languages/parts/${lang}-${domain}.ts`;
            const absolutePath = path.join(WORKSPACE_ROOT, partFile);

            if (!fs.existsSync(absolutePath)) {
                errors.push(`缺少语言域分片：${partFile}`);
                continue;
            }

            const keys = parsePartKeys(readText(partFile));
            if (keys.length === 0) {
                errors.push(`语言域分片为空：${partFile}`);
                continue;
            }

            const localSet = new Set();
            for (const key of keys) {
                if (localSet.has(key)) {
                    errors.push(`语言域分片内重复 key：${partFile} -> ${key}`);
                    continue;
                }
                localSet.add(key);

                const expectedDomain = keyDomainMap.get(key);
                if (!expectedDomain) {
                    errors.push(`语言分片包含未知 key：${partFile} -> ${key}`);
                    continue;
                }
                if (expectedDomain !== domain) {
                    errors.push(
                        `语言分片跨域混放：${partFile} -> ${key}（应在 ${expectedDomain}）`,
                    );
                    continue;
                }

                if (langKeySet.has(key)) {
                    errors.push(`同一语言出现重复 key：${lang} -> ${key}`);
                    continue;
                }
                langKeySet.add(key);
            }
        }

        const missing = setDifference(allKeySet, langKeySet);
        if (missing.length > 0) {
            errors.push(
                `语言 ${lang} 缺失 key：${missing.slice(0, 20).join(", ")}（共 ${missing.length} 项）`,
            );
        }

        const extra = setDifference(langKeySet, allKeySet);
        if (extra.length > 0) {
            errors.push(
                `语言 ${lang} 存在额外 key：${extra.slice(0, 20).join(", ")}（共 ${extra.length} 项）`,
            );
        }
    }

    if (errors.length > 0) {
        console.error("[i18n-structure-check] failed");
        for (const error of errors) {
            console.error(`- ${error}`);
        }
        process.exit(1);
    }

    console.log(`[i18n-structure-check] passed (${allKeySet.size} keys)`);
}

main();
