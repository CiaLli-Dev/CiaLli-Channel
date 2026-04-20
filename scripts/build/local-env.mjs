import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

function normalizeMode(value) {
    return String(value || "").trim();
}

function resolveEnvFilenames(mode) {
    const filenames = [".env", ".env.local"];
    if (!mode) {
        return filenames;
    }

    filenames.push(`.env.${mode}`, `.env.${mode}.local`);
    return filenames;
}

export function resolveEnvMode(argv, defaultMode) {
    const normalizedDefaultMode = normalizeMode(defaultMode);

    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index] || "").trim();
        if (!argument) {
            continue;
        }

        if (argument === "--mode") {
            return normalizeMode(argv[index + 1]) || normalizedDefaultMode;
        }

        if (argument.startsWith("--mode=")) {
            return (
                normalizeMode(argument.slice("--mode=".length)) ||
                normalizedDefaultMode
            );
        }
    }

    return normalizedDefaultMode;
}

export function stripArgSeparators(argv) {
    return argv.filter((argument) => String(argument || "").trim() !== "--");
}

/**
 * 仅为本地 Node 入口补齐 `.env*` 到 `process.env` 的注入。
 * 外部已显式传入的环境变量优先级最高，不会被本地文件覆盖；
 * 同时按 Vite/Astro 约定让 mode-specific 与 `.local` 文件覆盖通用文件。
 */
export function loadLocalEnv(options = {}) {
    const rootDir = String(options.rootDir || process.cwd());
    const mode = normalizeMode(options.mode);
    const processEnv = options.processEnv || process.env;
    const externalEnvKeys = new Set(Object.keys(processEnv));
    const mergedEntries = new Map();
    const loadedFiles = [];

    for (const filename of resolveEnvFilenames(mode)) {
        const filePath = path.join(rootDir, filename);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            continue;
        }

        const parsed = dotenv.parse(fs.readFileSync(filePath, "utf8"));
        loadedFiles.push(filename);

        for (const [key, value] of Object.entries(parsed)) {
            mergedEntries.set(key, value);
        }
    }

    const appliedKeys = [];
    for (const [key, value] of mergedEntries) {
        if (externalEnvKeys.has(key)) {
            continue;
        }

        processEnv[key] = value;
        appliedKeys.push(key);
    }

    return {
        mode,
        loadedFiles,
        appliedKeys,
    };
}
