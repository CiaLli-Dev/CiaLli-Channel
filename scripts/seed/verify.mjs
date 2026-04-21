#!/usr/bin/env node

import fs from "node:fs/promises";

import {
    DIRECTUS_SCHEMA_PATH,
    isGitLfsPointerFile,
    listFilesRecursive,
    ROOT_DIR,
    SEED_METADATA_PATH,
    SEED_MINIO_DIR,
    SEED_POSTGRES_DUMP_PATH,
} from "./common.mjs";

async function assertFileExists(filePath, label) {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) {
            throw new Error(`${label} 为空或不是普通文件: ${filePath}`);
        }
    } catch (error) {
        throw new Error(`${label} 不存在: ${filePath}`, { cause: error });
    }
}

async function assertDirectoryExists(dirPath, label) {
    try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
            throw new Error(`${label} 不是目录: ${dirPath}`);
        }
    } catch (error) {
        throw new Error(`${label} 不存在: ${dirPath}`, { cause: error });
    }
}

async function main() {
    await assertFileExists(SEED_POSTGRES_DUMP_PATH, "PostgreSQL seed dump");
    await assertFileExists(SEED_METADATA_PATH, "seed 元数据");
    await assertFileExists(DIRECTUS_SCHEMA_PATH, "Directus schema 快照");
    await assertDirectoryExists(SEED_MINIO_DIR, "MinIO seed 目录");

    if (await isGitLfsPointerFile(SEED_POSTGRES_DUMP_PATH)) {
        throw new Error(
            "PostgreSQL seed dump 仍是 Git LFS pointer，请先执行 `git lfs pull`。",
        );
    }

    const schemaRaw = await fs.readFile(DIRECTUS_SCHEMA_PATH, "utf8");
    const trimmedSchema = schemaRaw.trim();
    if (trimmedSchema.startsWith("{")) {
        JSON.parse(trimmedSchema);
    } else if (!trimmedSchema.startsWith("version:")) {
        throw new Error(
            "Directus schema 快照既不是 JSON，也不是当前 Directus 导出的 YAML 文本格式。",
        );
    }

    const metadataRaw = await fs.readFile(SEED_METADATA_PATH, "utf8");
    const metadata = JSON.parse(metadataRaw);

    const minioFiles = await listFilesRecursive(SEED_MINIO_DIR);
    for (const filePath of minioFiles) {
        if (await isGitLfsPointerFile(filePath)) {
            throw new Error(
                `MinIO seed 对象仍是 Git LFS pointer，请先拉取真实内容: ${filePath}`,
            );
        }
    }

    if (
        typeof metadata?.minio?.objectCount === "number" &&
        metadata.minio.objectCount !== minioFiles.length
    ) {
        throw new Error(
            `MinIO 对象数量与元数据不一致: metadata=${metadata.minio.objectCount}, actual=${minioFiles.length}`,
        );
    }

    const dumpStat = await fs.stat(SEED_POSTGRES_DUMP_PATH);
    if (
        typeof metadata?.postgres?.dumpBytes === "number" &&
        metadata.postgres.dumpBytes !== dumpStat.size
    ) {
        throw new Error(
            `PostgreSQL dump 大小与元数据不一致: metadata=${metadata.postgres.dumpBytes}, actual=${dumpStat.size}`,
        );
    }

    console.info("[seed:verify] 演示 seed 校验通过。");
    console.info(
        JSON.stringify(
            {
                seedRoot: ROOT_DIR,
                postgresDumpBytes: dumpStat.size,
                minioObjectCount: minioFiles.length,
            },
            null,
            2,
        ),
    );
}

await main();
