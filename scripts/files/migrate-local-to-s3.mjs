#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

loadDotenv();

const DIRECTUS_CONTAINER_NAME =
    process.env.DIRECTUS_CONTAINER_NAME || "cialli-channel-directus-1";
const POSTGRES_CONTAINER_NAME =
    process.env.POSTGRES_CONTAINER_NAME || "cialli-channel-postgres-1";
const MINIO_MC_IMAGE =
    process.env.MINIO_MC_IMAGE || "minio/mc:RELEASE.2025-03-12T17-29-24Z";
const MINIO_NETWORK = process.env.MINIO_NETWORK || "cialli-channel_default";
const BACKUP_DIR = path.resolve(process.cwd(), "backups");
const TIMESTAMP = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\..+/, "");
const LOCAL_DB_BACKUP_PATH = path.join(
    BACKUP_DIR,
    `local-before-local-to-s3-${TIMESTAMP}.dump`,
);
const LOCAL_UPLOADS_BACKUP_PATH = path.join(
    BACKUP_DIR,
    `local-uploads-before-local-to-s3-${TIMESTAMP}.tar`,
);
const MIGRATION_REPORT_PATH = path.join(
    BACKUP_DIR,
    `local-to-s3-report-${TIMESTAMP}.json`,
);
const ROLLBACK_SQL_PATH = path.join(
    BACKUP_DIR,
    `local-to-s3-rollback-${TIMESTAMP}.sql`,
);
const POSTGRES_USER = "directus";
const POSTGRES_DB = "directus";
const MINIO_ROOT_USER = "minioadmin";
const MINIO_BUCKET = "cialli-assets";
const STORAGE_S3_ENDPOINT = "http://minio:9000";

const REQUIRED_ENV_NAMES = ["POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD"];

const dryRun = process.argv.includes("--dry-run");

/**
 * 迁移脚本本身不走业务代码，而是直接通过 docker exec / docker run 操作。
 * 这样可以最大化复用当前已经跑起来的容器环境，避免再引入新的数据库或 S3 SDK 依赖。
 */

function readEnv(name) {
    return String(process.env[name] || "").trim();
}

function assertEnv() {
    const missing = REQUIRED_ENV_NAMES.filter((name) => !readEnv(name));
    if (missing.length > 0) {
        throw new Error(`缺少迁移必填环境变量: ${missing.join(", ")}`);
    }
}

function runCommand(command, args, options = {}) {
    return execFileSync(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        ...options,
    });
}

function runDocker(args, options = {}) {
    return runCommand("docker", args, options);
}

function quoteSqlString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

async function ensureBackupDir() {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
}

async function createLocalBackups() {
    if (dryRun) {
        console.info(
            "[files:migrate] dry-run 模式跳过本地数据库与 uploads 备份。",
        );
        return;
    }

    console.info(`[files:migrate] 备份本地数据库 -> ${LOCAL_DB_BACKUP_PATH}`);
    const dbDumpBuffer = runDocker(
        [
            "exec",
            "-e",
            `PGPASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
            POSTGRES_CONTAINER_NAME,
            "pg_dump",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-Fc",
        ],
        {
            encoding: null,
        },
    );
    await fs.writeFile(LOCAL_DB_BACKUP_PATH, dbDumpBuffer);

    console.info(
        `[files:migrate] 备份本地 uploads volume -> ${LOCAL_UPLOADS_BACKUP_PATH}`,
    );
    const uploadsTarBuffer = runDocker(
        [
            "exec",
            DIRECTUS_CONTAINER_NAME,
            "sh",
            "-lc",
            "cd /directus/uploads && tar cf - .",
        ],
        {
            encoding: null,
        },
    );
    await fs.writeFile(LOCAL_UPLOADS_BACKUP_PATH, uploadsTarBuffer);
}

function readLocalRows() {
    const raw = runDocker([
        "exec",
        "-e",
        `PGPASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
        POSTGRES_CONTAINER_NAME,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
        "-F",
        "\t",
        "-c",
        "select id, filename_disk, coalesce(filesize, 0) from directus_files where storage = 'local' order by uploaded_on nulls last, id;",
    ]).trim();

    if (!raw) {
        return [];
    }

    return raw
        .split("\n")
        .map((line) => {
            const [id, filenameDisk, filesizeRaw] = line.split("\t");
            return {
                id: String(id || "").trim(),
                filenameDisk: String(filenameDisk || "").trim(),
                filesize: Number.parseInt(String(filesizeRaw || "0"), 10) || 0,
            };
        })
        .filter((row) => row.id && row.filenameDisk);
}

async function materializeUploadsSnapshot(tempRoot) {
    const uploadsDir = path.join(tempRoot, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    runDocker([
        "cp",
        `${DIRECTUS_CONTAINER_NAME}:/directus/uploads/.`,
        uploadsDir,
    ]);
    return uploadsDir;
}

function buildMcShellCommand(action) {
    return [
        "run",
        "--rm",
        "--network",
        MINIO_NETWORK,
        "--entrypoint",
        "/bin/sh",
        "-e",
        `MINIO_ROOT_USER=${MINIO_ROOT_USER}`,
        "-e",
        `MINIO_ROOT_PASSWORD=${readEnv("MINIO_ROOT_PASSWORD")}`,
        "-e",
        `MINIO_BUCKET=${MINIO_BUCKET}`,
        "-e",
        `STORAGE_S3_ENDPOINT=${STORAGE_S3_ENDPOINT}`,
        "-e",
        action.objectKey ? `OBJECT_KEY=${action.objectKey}` : "OBJECT_KEY=",
        action.sourcePath ? "-v" : "",
        action.sourcePath ? `${action.sourcePath}:/source:ro` : "",
        MINIO_MC_IMAGE,
        "-lc",
        action.command,
    ].filter(Boolean);
}

function readRemoteObjectSize(objectKey) {
    try {
        const output = runDocker(
            buildMcShellCommand({
                objectKey,
                command:
                    'mc alias set target "$STORAGE_S3_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && mc stat --json "target/$MINIO_BUCKET/$OBJECT_KEY"',
            }),
        ).trim();
        if (!output) {
            return null;
        }
        const parsed = JSON.parse(output);
        return Number(parsed.size || 0);
    } catch {
        return null;
    }
}

function uploadObject(sourcePath, objectKey) {
    runDocker(
        buildMcShellCommand({
            objectKey,
            sourcePath: path.dirname(sourcePath),
            command:
                'mc alias set target "$STORAGE_S3_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && mc cp "/source/$OBJECT_KEY" "target/$MINIO_BUCKET/$OBJECT_KEY"',
        }),
    );
}

function updateRowStorageToS3(id) {
    runDocker([
        "exec",
        "-e",
        `PGPASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
        POSTGRES_CONTAINER_NAME,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `update directus_files set storage = 's3' where id = ${quoteSqlString(id)} and storage = 'local';`,
    ]);
}

function readStorageCounts() {
    const output = runDocker([
        "exec",
        "-e",
        `PGPASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
        POSTGRES_CONTAINER_NAME,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        POSTGRES_DB,
        "-At",
        "-F",
        "\t",
        "-c",
        "select storage, count(*) from directus_files group by storage order by storage;",
    ]).trim();

    if (!output) {
        return new Map();
    }

    return new Map(
        output.split("\n").map((line) => {
            const [storage, count] = line.split("\t");
            return [
                String(storage || "").trim(),
                Number.parseInt(String(count || "0"), 10) || 0,
            ];
        }),
    );
}

async function writeMigrationArtifacts(report) {
    await fs.writeFile(
        MIGRATION_REPORT_PATH,
        JSON.stringify(report, null, 2),
        "utf8",
    );

    const migratedIds = report.results
        .filter(
            (entry) =>
                entry.status === "migrated" ||
                entry.status === "skipped-existing",
        )
        .map((entry) => entry.id);

    const rollbackSql =
        migratedIds.length > 0
            ? `update directus_files set storage = 'local' where id in (${migratedIds
                  .map((id) => quoteSqlString(id))
                  .join(", ")});\n`
            : "-- no migrated rows\n";

    await fs.writeFile(ROLLBACK_SQL_PATH, rollbackSql, "utf8");
}

async function main() {
    assertEnv();
    await ensureBackupDir();

    const rows = readLocalRows();
    console.info(`[files:migrate] 待处理 local 文件记录: ${rows.length}`);

    const report = {
        dryRun,
        startedAt: new Date().toISOString(),
        results: [],
    };

    if (rows.length === 0) {
        await writeMigrationArtifacts(report);
        console.info(
            "[files:migrate] 当前没有 storage='local' 的记录，迁移结束。",
        );
        return;
    }

    await createLocalBackups();

    const tempRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "cialli-local-to-s3-"),
    );

    try {
        const uploadsDir = await materializeUploadsSnapshot(tempRoot);

        for (const row of rows) {
            const sourcePath = path.join(uploadsDir, row.filenameDisk);

            try {
                const stat = await fs.stat(sourcePath);
                if (!stat.isFile()) {
                    throw new Error("源文件不是普通文件");
                }

                if (row.filesize > 0 && stat.size !== row.filesize) {
                    throw new Error(
                        `源文件大小与数据库不一致: db=${row.filesize}, actual=${stat.size}`,
                    );
                }

                const remoteSize = readRemoteObjectSize(row.filenameDisk);
                if (remoteSize === stat.size) {
                    report.results.push({
                        id: row.id,
                        filenameDisk: row.filenameDisk,
                        status: "skipped-existing",
                        size: stat.size,
                    });

                    if (!dryRun) {
                        updateRowStorageToS3(row.id);
                    }
                    continue;
                }

                if (!dryRun) {
                    uploadObject(sourcePath, row.filenameDisk);
                    updateRowStorageToS3(row.id);
                }

                report.results.push({
                    id: row.id,
                    filenameDisk: row.filenameDisk,
                    status: dryRun ? "planned" : "migrated",
                    size: stat.size,
                });
            } catch (error) {
                report.results.push({
                    id: row.id,
                    filenameDisk: row.filenameDisk,
                    status: "failed",
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        }
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }

    report.finishedAt = new Date().toISOString();
    report.summary = {
        total: report.results.length,
        migrated: report.results.filter((entry) => entry.status === "migrated")
            .length,
        planned: report.results.filter((entry) => entry.status === "planned")
            .length,
        skipped: report.results.filter(
            (entry) => entry.status === "skipped-existing",
        ).length,
        failed: report.results.filter((entry) => entry.status === "failed")
            .length,
    };
    report.storageCounts = Object.fromEntries(readStorageCounts());

    await writeMigrationArtifacts(report);

    console.info("[files:migrate] 迁移结果:");
    console.info(JSON.stringify(report.summary, null, 2));

    const failed = report.results.filter((entry) => entry.status === "failed");
    if (failed.length > 0) {
        console.error("[files:migrate] 失败文件:");
        for (const item of failed) {
            console.error(`- ${item.filenameDisk}: ${item.error}`);
        }
        process.exit(1);
    }

    console.info(
        `[files:migrate] 报告已写入 ${MIGRATION_REPORT_PATH}，回滚 SQL 已写入 ${ROLLBACK_SQL_PATH}`,
    );
}

main().catch((error) => {
    console.error("[files:migrate] 执行失败:", error);
    process.exit(1);
});
