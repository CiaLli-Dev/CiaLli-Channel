#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    DIRECTUS_SCHEMA_PATH,
    isGitLfsPointerFile,
    LEGACY_DEMO_ADMIN_EMAIL,
    listFilesRecursive,
    ROOT_DIR,
    runDocker,
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

function createVerifyContainerName() {
    return `cialli-seed-verify-${randomUUID().slice(0, 8)}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgresReady(containerName, retries = 30) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            runDocker([
                "exec",
                containerName,
                "pg_isready",
                "-U",
                "postgres",
                "-d",
                "directus",
            ]);
            return;
        } catch (error) {
            if (attempt === retries - 1) {
                throw error;
            }
            await sleep(1000);
        }
    }
}

async function queryRestoredDatabase(containerName, postgresPassword, sql) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
            return runDocker([
                "exec",
                "-e",
                `PGPASSWORD=${postgresPassword}`,
                containerName,
                "psql",
                "-U",
                "postgres",
                "-d",
                "directus",
                "-At",
                "-c",
                sql,
            ]).trim();
        } catch (error) {
            if (attempt === 9) {
                throw error;
            }
            await sleep(500);
        }
    }
    return "";
}

async function verifyRestoredSeedDatabase() {
    const containerName = createVerifyContainerName();
    const postgresPassword = "verify-password";
    const seedPostgresDir = path.dirname(SEED_POSTGRES_DUMP_PATH);

    try {
        runDocker([
            "run",
            "-d",
            "--rm",
            "--platform",
            "linux/amd64",
            "--name",
            containerName,
            "-e",
            `POSTGRES_PASSWORD=${postgresPassword}`,
            "-e",
            "POSTGRES_DB=directus",
            "-v",
            `${seedPostgresDir}:/seed/postgres:ro`,
            "postgis/postgis:18-3.6",
        ]);

        await waitForPostgresReady(containerName);

        runDocker([
            "exec",
            "-e",
            `PGPASSWORD=${postgresPassword}`,
            containerName,
            "pg_restore",
            "--no-owner",
            "--no-privileges",
            "-U",
            "postgres",
            "-d",
            "directus",
            "/seed/postgres/demo.dump",
        ]);

        await waitForPostgresReady(containerName);

        const demoAdminCount = await queryRestoredDatabase(
            containerName,
            postgresPassword,
            `select count(*) from directus_users where lower(email) = lower('${LEGACY_DEMO_ADMIN_EMAIL}');`,
        );

        if (demoAdminCount !== "0") {
            throw new Error(
                `seed dump 仍包含 legacy demo admin: ${LEGACY_DEMO_ADMIN_EMAIL}`,
            );
        }

        const tokenCount = await queryRestoredDatabase(
            containerName,
            postgresPassword,
            "select count(*) from directus_users where token is not null;",
        );

        if (tokenCount !== "0") {
            throw new Error(
                `seed dump 中仍存在可复用 Directus static token: ${tokenCount}`,
            );
        }

        const sessionCount = await queryRestoredDatabase(
            containerName,
            postgresPassword,
            "select count(*) from directus_sessions;",
        );

        if (sessionCount !== "0") {
            throw new Error(
                `seed dump 中仍存在可复用 Directus session: ${sessionCount}`,
            );
        }
    } finally {
        try {
            runDocker(["rm", "-f", containerName]);
        } catch {
            // ignore cleanup errors
        }
    }
}

async function main() {
    const skipRestoreVerification =
        process.env.SEED_VERIFY_SKIP_RESTORE === "1";

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

    if (!skipRestoreVerification) {
        await verifyRestoredSeedDatabase();
    }

    console.info("[seed:verify] 演示 seed 校验通过。");
    if (skipRestoreVerification) {
        console.info(
            "[seed:verify] 已跳过临时数据库 restore 验证（SEED_VERIFY_SKIP_RESTORE=1）。",
        );
    } else {
        console.info(
            `[seed:verify] 已确认 seed dump 不包含 legacy demo admin 或可复用认证状态: ${LEGACY_DEMO_ADMIN_EMAIL}`,
        );
    }
    console.info(
        JSON.stringify(
            {
                seedRoot: ROOT_DIR,
                postgresDumpBytes: dumpStat.size,
                minioObjectCount: minioFiles.length,
                restoredSeedVerified: !skipRestoreVerification,
            },
            null,
            2,
        ),
    );
}

await main();
