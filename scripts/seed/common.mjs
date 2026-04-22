#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

export const ROOT_DIR = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
);

export const SEED_DIR = path.join(ROOT_DIR, "seed");
export const SEED_POSTGRES_DIR = path.join(SEED_DIR, "postgres");
export const SEED_MINIO_DIR = path.join(SEED_DIR, "minio", "demo-bucket");
export const SEED_METADATA_PATH = path.join(SEED_DIR, "metadata.json");
export const SEED_POSTGRES_DUMP_PATH = path.join(
    SEED_POSTGRES_DIR,
    "demo.dump",
);
export const DIRECTUS_SCHEMA_PATH = path.join(
    ROOT_DIR,
    "directus",
    "schema",
    "app-schema.json",
);

export const LEGACY_DEMO_ADMIN_EMAIL = "demo-admin@example.com";

export function readEnv(name) {
    return String(process.env[name] || "").trim();
}

export function assertEnv(names) {
    const missing = names.filter((name) => !readEnv(name));
    if (missing.length > 0) {
        throw new Error(`缺少必填环境变量: ${missing.join(", ")}`);
    }
}

export function runCommand(command, args, options = {}) {
    return execFileSync(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
        ...options,
    });
}

export function runDocker(args, options = {}) {
    return runCommand("docker", args, options);
}

export function runDockerCompose(args, options = {}) {
    return runDocker(["compose", ...args], options);
}

export async function ensureDir(targetPath) {
    await fs.mkdir(targetPath, { recursive: true });
}

export async function resetDir(targetPath) {
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.mkdir(targetPath, { recursive: true });
}

export async function withTempDir(prefix, callback) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    try {
        return await callback(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

export function resolveComposeContainerId(service) {
    const id = runDockerCompose(["ps", "-q", service]).trim();
    if (!id) {
        throw new Error(`未找到 compose service 容器: ${service}`);
    }
    return id;
}

export function dockerCopyFromContainer(source, target) {
    runDocker(["cp", source, target]);
}

export async function writeJson(targetPath, value) {
    await fs.writeFile(
        targetPath,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
    );
}

export async function listFilesRecursive(rootPath) {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFilesRecursive(fullPath)));
            continue;
        }
        if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files.sort();
}

export async function isGitLfsPointerFile(filePath) {
    const handle = await fs.open(filePath, "r");
    try {
        const { buffer, bytesRead } = await handle.read({
            buffer: Buffer.alloc(256),
            position: 0,
        });
        const header = buffer.subarray(0, bytesRead).toString("utf8");
        return header.startsWith("version https://git-lfs.github.com/spec/v1");
    } finally {
        await handle.close();
    }
}
