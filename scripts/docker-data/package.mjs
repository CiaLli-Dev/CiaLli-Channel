#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
    assertEnv,
    dockerCopyFromContainer,
    ensureDir,
    listFilesRecursive,
    readEnv,
    resolveComposeContainerId,
    ROOT_DIR,
    runCommand,
    runDocker,
    runDockerCompose,
    withTempDir,
    writeJson,
} from "../seed/common.mjs";

const FORMAT_VERSION = 1;
const BACKUP_DIR = path.join(ROOT_DIR, "backups");
const POSTGRES_DUMP_ENTRY = "postgres/directus.dump";
const DIRECTUS_SCHEMA_ENTRY = "directus/schema.json";
const MINIO_OBJECTS_ROOT_ENTRY = "minio/objects";
const MINIO_OBJECTS_MANIFEST_ENTRY = "minio/objects-manifest.json";
const MANIFEST_ENTRY = "manifest.json";
const WRITABLE_SERVICES = ["web", "worker", "directus"];
const MINIO_BUCKET = "cialli-assets";

const REQUIRED_ENV_NAMES = [
    "POSTGRES_USER",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
];

function readPostgresDatabase() {
    return readEnv("POSTGRES_DB");
}

function readPostgresUser() {
    return readEnv("POSTGRES_USER");
}

function readMinioRootUser() {
    return readEnv("MINIO_ROOT_USER");
}

function nowStamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        "-",
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join("");
}

function usage() {
    return [
        "Usage:",
        "  pnpm docker:data:export [--output backups/docker-data.zip]",
        "  pnpm docker:data:verify <package.zip>",
        "  pnpm docker:data:import <package.zip> [--backup-output backups/before-import.zip] [--no-backup]",
        "",
        "Commands:",
        "  export    Export PostgreSQL, Directus schema, and MinIO bucket objects into a verified .zip package.",
        "  verify    Verify a .zip package manifest and all SHA-256 checksums without touching Docker.",
        "  import    Backup the current Docker data, verify both packages, then overwrite PostgreSQL and MinIO.",
    ].join("\n");
}

function parseArgs(argv) {
    const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
    const [command, ...rest] = normalizedArgv;
    const options = {
        command:
            command === "--help" || command === "-h"
                ? "help"
                : command || "help",
        positional: [],
        output: null,
        backupOutput: null,
        noBackup: false,
    };

    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === "--output") {
            if (!rest[index + 1]) {
                throw new Error("--output 需要提供路径");
            }
            options.output = rest[index + 1];
            index += 1;
            continue;
        }
        if (token === "--backup-output") {
            if (!rest[index + 1]) {
                throw new Error("--backup-output 需要提供路径");
            }
            options.backupOutput = rest[index + 1];
            index += 1;
            continue;
        }
        if (token === "--no-backup") {
            options.noBackup = true;
            continue;
        }
        if (token === "--help" || token === "-h") {
            options.command = "help";
            continue;
        }
        options.positional.push(token);
    }

    return options;
}

function resolveFromRoot(value) {
    return path.resolve(ROOT_DIR, value);
}

function defaultExportPath(prefix = "docker-data") {
    return path.join(BACKUP_DIR, `${prefix}-${nowStamp()}.zip`);
}

function assertZipPath(targetPath) {
    if (path.extname(targetPath).toLowerCase() !== ".zip") {
        throw new Error(`数据包路径必须以 .zip 结尾: ${targetPath}`);
    }
}

function assertHostCommand(command) {
    runCommand(command, ["-v"]);
}

function runPostgresExec(args, options = {}) {
    return runDockerCompose(
        [
            "exec",
            "-T",
            "-e",
            `PGPASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
            "postgres",
            ...args,
        ],
        options,
    );
}

function minioShell(script, options = {}) {
    return runDockerCompose(
        [
            "exec",
            "-T",
            "-e",
            `MINIO_BUCKET=${MINIO_BUCKET}`,
            "-e",
            `MINIO_ROOT_USER=${readMinioRootUser()}`,
            "-e",
            `MINIO_ROOT_PASSWORD=${readEnv("MINIO_ROOT_PASSWORD")}`,
            "minio",
            "sh",
            "-lc",
            script,
        ],
        options,
    );
}

function createMinioAliasCommand() {
    return 'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1';
}

async function sha256File(filePath) {
    const hash = createHash("sha256");
    await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
    });
    return hash.digest("hex");
}

async function readJson(filePath, label) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
        throw new Error(`${label} 不是有效 JSON: ${filePath}`, {
            cause: error,
        });
    }
}

async function fileStatsWithHash(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
        throw new Error(`不是普通文件: ${filePath}`);
    }
    return {
        bytes: stat.size,
        sha256: await sha256File(filePath),
    };
}

function toZipKey(baseDir, filePath) {
    return path.relative(baseDir, filePath).split(path.sep).join("/");
}

async function createObjectsManifest(objectsDir) {
    const files = await listFilesRecursive(objectsDir);
    const objects = [];

    for (const filePath of files) {
        const objectStats = await fileStatsWithHash(filePath);
        objects.push({
            key: toZipKey(objectsDir, filePath),
            bytes: objectStats.bytes,
            sha256: objectStats.sha256,
        });
    }

    return objects.sort((left, right) => left.key.localeCompare(right.key));
}

async function readPackageVersion() {
    const packageJson = await readJson(
        path.join(ROOT_DIR, "package.json"),
        "package.json",
    );
    return typeof packageJson.version === "string" ? packageJson.version : null;
}

function validateZipEntries(entries) {
    for (const entry of entries) {
        if (!entry || entry.startsWith("/") || entry.includes("\\")) {
            throw new Error(`zip 内存在非法路径: ${entry}`);
        }
        const normalized = path.posix.normalize(entry);
        if (
            normalized === "." ||
            normalized === ".." ||
            normalized.startsWith("../")
        ) {
            throw new Error(`zip 内存在路径穿越条目: ${entry}`);
        }
    }
}

async function unzipPackage(zipPath, targetDir) {
    assertHostCommand("unzip");
    const entries = runCommand("unzip", ["-Z1", zipPath])
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean);

    validateZipEntries(entries);
    await ensureDir(targetDir);
    runCommand("unzip", ["-qq", zipPath, "-d", targetDir]);
}

async function createZipFromDirectory(sourceDir, outputPath) {
    assertHostCommand("zip");
    await ensureDir(path.dirname(outputPath));
    await fs.rm(outputPath, { force: true });
    runCommand("zip", ["-qr", outputPath, "."], { cwd: sourceDir });
}

async function assertRequiredFile(filePath, label) {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) {
            throw new Error(`${label} 为空或不是普通文件: ${filePath}`);
        }
    } catch (error) {
        throw new Error(`${label} 不存在: ${filePath}`, { cause: error });
    }
}

async function assertRequiredDir(dirPath, label) {
    try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
            throw new Error(`${label} 不是目录: ${dirPath}`);
        }
    } catch (error) {
        throw new Error(`${label} 不存在: ${dirPath}`, { cause: error });
    }
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象`);
    }
}

function assertString(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${label} 必须是非空字符串`);
    }
}

function assertNumber(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`${label} 必须是非负数字`);
    }
}

function assertSha256(value, label) {
    assertString(value, label);
    if (!/^[a-f0-9]{64}$/u.test(value)) {
        throw new Error(`${label} 必须是 64 位小写 SHA-256 十六进制摘要`);
    }
}

function validateManifestShape(manifest) {
    assertPlainObject(manifest, "manifest");
    if (manifest.formatVersion !== FORMAT_VERSION) {
        throw new Error(
            `不支持的数据包格式版本: ${String(manifest.formatVersion)}`,
        );
    }

    assertString(manifest.generatedAt, "manifest.generatedAt");
    assertPlainObject(manifest.source, "manifest.source");
    assertString(manifest.source.type, "manifest.source.type");
    assertString(manifest.source.createdBy, "manifest.source.createdBy");
    assertPlainObject(manifest.postgres, "manifest.postgres");
    assertString(manifest.postgres.database, "manifest.postgres.database");
    assertString(manifest.postgres.dumpFile, "manifest.postgres.dumpFile");
    assertSha256(manifest.postgres.dumpSha256, "manifest.postgres.dumpSha256");
    assertNumber(manifest.postgres.dumpBytes, "manifest.postgres.dumpBytes");
    assertPlainObject(manifest.directus, "manifest.directus");
    assertString(manifest.directus.schemaFile, "manifest.directus.schemaFile");
    assertSha256(
        manifest.directus.schemaSha256,
        "manifest.directus.schemaSha256",
    );
    assertNumber(
        manifest.directus.schemaBytes,
        "manifest.directus.schemaBytes",
    );
    assertPlainObject(manifest.minio, "manifest.minio");
    assertString(manifest.minio.bucket, "manifest.minio.bucket");
    assertString(manifest.minio.objectsRoot, "manifest.minio.objectsRoot");
    assertString(
        manifest.minio.objectsManifestFile,
        "manifest.minio.objectsManifestFile",
    );
    assertSha256(
        manifest.minio.objectsManifestSha256,
        "manifest.minio.objectsManifestSha256",
    );
    assertNumber(manifest.minio.objectCount, "manifest.minio.objectCount");
}

function validateObjectsManifestShape(objectsManifest) {
    if (!Array.isArray(objectsManifest)) {
        throw new Error("minio/objects-manifest.json 必须是数组");
    }

    const seenKeys = new Set();
    for (const [index, objectEntry] of objectsManifest.entries()) {
        assertPlainObject(objectEntry, `objectsManifest[${index}]`);
        assertString(objectEntry.key, `objectsManifest[${index}].key`);
        assertNumber(objectEntry.bytes, `objectsManifest[${index}].bytes`);
        assertSha256(objectEntry.sha256, `objectsManifest[${index}].sha256`);
        const normalizedKey = path.posix.normalize(objectEntry.key);
        if (
            objectEntry.key.startsWith("/") ||
            objectEntry.key.includes("\\") ||
            normalizedKey === "." ||
            normalizedKey === ".." ||
            normalizedKey.startsWith("../")
        ) {
            throw new Error(`MinIO 对象 key 非法: ${objectEntry.key}`);
        }
        if (seenKeys.has(objectEntry.key)) {
            throw new Error(`MinIO 对象清单存在重复 key: ${objectEntry.key}`);
        }
        seenKeys.add(objectEntry.key);
    }
}

async function verifyExtractedPackage(packageDir) {
    const manifestPath = path.join(packageDir, MANIFEST_ENTRY);
    const postgresDumpPath = path.join(packageDir, POSTGRES_DUMP_ENTRY);
    const directusSchemaPath = path.join(packageDir, DIRECTUS_SCHEMA_ENTRY);
    const minioObjectsDir = path.join(packageDir, MINIO_OBJECTS_ROOT_ENTRY);
    const objectsManifestPath = path.join(
        packageDir,
        MINIO_OBJECTS_MANIFEST_ENTRY,
    );

    await assertRequiredFile(manifestPath, "manifest");
    await assertRequiredFile(postgresDumpPath, "PostgreSQL dump");
    await assertRequiredFile(directusSchemaPath, "Directus schema");
    await assertRequiredFile(objectsManifestPath, "MinIO 对象清单");
    await assertRequiredDir(minioObjectsDir, "MinIO 对象目录");

    const manifest = await readJson(manifestPath, "manifest");
    validateManifestShape(manifest);

    if (manifest.postgres.dumpFile !== POSTGRES_DUMP_ENTRY) {
        throw new Error(
            `PostgreSQL dump 路径不匹配: ${manifest.postgres.dumpFile}`,
        );
    }
    if (manifest.directus.schemaFile !== DIRECTUS_SCHEMA_ENTRY) {
        throw new Error(
            `Directus schema 路径不匹配: ${manifest.directus.schemaFile}`,
        );
    }
    if (manifest.minio.objectsRoot !== MINIO_OBJECTS_ROOT_ENTRY) {
        throw new Error(
            `MinIO 对象根目录不匹配: ${manifest.minio.objectsRoot}`,
        );
    }
    if (manifest.minio.objectsManifestFile !== MINIO_OBJECTS_MANIFEST_ENTRY) {
        throw new Error(
            `MinIO 对象清单路径不匹配: ${manifest.minio.objectsManifestFile}`,
        );
    }

    const dumpStats = await fileStatsWithHash(postgresDumpPath);
    if (
        dumpStats.bytes !== manifest.postgres.dumpBytes ||
        dumpStats.sha256 !== manifest.postgres.dumpSha256
    ) {
        throw new Error("PostgreSQL dump SHA-256 或大小与 manifest 不一致");
    }

    const schemaStats = await fileStatsWithHash(directusSchemaPath);
    if (
        schemaStats.bytes !== manifest.directus.schemaBytes ||
        schemaStats.sha256 !== manifest.directus.schemaSha256
    ) {
        throw new Error("Directus schema SHA-256 或大小与 manifest 不一致");
    }

    const objectsManifestStats = await fileStatsWithHash(objectsManifestPath);
    if (objectsManifestStats.sha256 !== manifest.minio.objectsManifestSha256) {
        throw new Error("MinIO 对象清单 SHA-256 与 manifest 不一致");
    }

    const objectsManifest = await readJson(
        objectsManifestPath,
        "MinIO 对象清单",
    );
    validateObjectsManifestShape(objectsManifest);
    if (objectsManifest.length !== manifest.minio.objectCount) {
        throw new Error(
            `MinIO 对象数量不一致: manifest=${manifest.minio.objectCount}, objects=${objectsManifest.length}`,
        );
    }

    const actualFiles = await listFilesRecursive(minioObjectsDir);
    const actualKeys = actualFiles.map((filePath) =>
        toZipKey(minioObjectsDir, filePath),
    );
    const expectedKeys = objectsManifest.map((entry) => entry.key).sort();
    actualKeys.sort();

    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        throw new Error("MinIO 对象目录内容与 objects-manifest.json 不一致");
    }

    for (const objectEntry of objectsManifest) {
        const objectPath = path.join(minioObjectsDir, objectEntry.key);
        const objectStats = await fileStatsWithHash(objectPath);
        if (
            objectStats.bytes !== objectEntry.bytes ||
            objectStats.sha256 !== objectEntry.sha256
        ) {
            throw new Error(`MinIO 对象校验失败: ${objectEntry.key}`);
        }
    }

    return manifest;
}

async function verifyPackage(zipPath) {
    const resolvedZipPath = resolveFromRoot(zipPath);
    assertZipPath(resolvedZipPath);
    await assertRequiredFile(resolvedZipPath, "Docker 数据 zip 包");

    return await withTempDir("cialli-docker-data-verify-", async (tempDir) => {
        await unzipPackage(resolvedZipPath, tempDir);
        const manifest = await verifyExtractedPackage(tempDir);
        console.info("[docker:data:verify] 数据包校验通过。");
        console.info(
            JSON.stringify(
                {
                    package: resolvedZipPath,
                    generatedAt: manifest.generatedAt,
                    postgresDumpBytes: manifest.postgres.dumpBytes,
                    minioObjectCount: manifest.minio.objectCount,
                },
                null,
                2,
            ),
        );
        return manifest;
    });
}

function ensureDockerServices() {
    for (const service of ["postgres", "minio", "directus"]) {
        resolveComposeContainerId(service);
    }
}

async function exportPostgresDump(dumpPath) {
    console.info("[docker:data:export] 导出 PostgreSQL dump。");
    const dumpBuffer = runPostgresExec(
        [
            "pg_dump",
            "-U",
            readPostgresUser(),
            "-d",
            readPostgresDatabase(),
            "-Fc",
        ],
        { encoding: null },
    );
    await fs.writeFile(dumpPath, dumpBuffer);
}

async function exportDirectusSchema(schemaPath) {
    console.info("[docker:data:export] 导出 Directus schema 快照。");
    const schemaJson = runDockerCompose([
        "exec",
        "-T",
        "directus",
        "sh",
        "-lc",
        [
            "rm -f /tmp/docker-data-schema.json",
            "npx directus schema snapshot /tmp/docker-data-schema.json --yes --format json >/dev/null",
            "cat /tmp/docker-data-schema.json",
        ].join(" && "),
    ]);
    await fs.writeFile(schemaPath, schemaJson, "utf8");
}

async function exportMinioObjects(objectsDir) {
    console.info("[docker:data:export] 导出 MinIO bucket 对象。");
    await ensureDir(objectsDir);

    const minioContainerId = resolveComposeContainerId("minio");
    const containerExportDir = "/tmp/docker-data-export";
    try {
        minioShell(
            [
                `rm -rf "${containerExportDir}"`,
                `mkdir -p "${containerExportDir}"`,
                createMinioAliasCommand(),
                'mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null 2>&1',
                `mc mirror --overwrite "local/$MINIO_BUCKET" "${containerExportDir}"`,
            ].join(" && "),
        );

        dockerCopyFromContainer(
            `${minioContainerId}:${containerExportDir}/.`,
            objectsDir,
        );
    } finally {
        minioShell(`rm -rf "${containerExportDir}"`);
    }
}

async function createManifest(stagingDir) {
    const postgresDumpPath = path.join(stagingDir, POSTGRES_DUMP_ENTRY);
    const directusSchemaPath = path.join(stagingDir, DIRECTUS_SCHEMA_ENTRY);
    const minioObjectsDir = path.join(stagingDir, MINIO_OBJECTS_ROOT_ENTRY);
    const objectsManifestPath = path.join(
        stagingDir,
        MINIO_OBJECTS_MANIFEST_ENTRY,
    );

    const objectsManifest = await createObjectsManifest(minioObjectsDir);
    await writeJson(objectsManifestPath, objectsManifest);

    const dumpStats = await fileStatsWithHash(postgresDumpPath);
    const schemaStats = await fileStatsWithHash(directusSchemaPath);
    const objectsManifestStats = await fileStatsWithHash(objectsManifestPath);

    return {
        formatVersion: FORMAT_VERSION,
        generatedAt: new Date().toISOString(),
        source: {
            type: "docker-compose",
            createdBy: "scripts/docker-data/package.mjs",
            appVersion: await readPackageVersion(),
        },
        postgres: {
            service: "postgres",
            database: readPostgresDatabase(),
            dumpFile: POSTGRES_DUMP_ENTRY,
            dumpBytes: dumpStats.bytes,
            dumpSha256: dumpStats.sha256,
        },
        directus: {
            service: "directus",
            schemaFile: DIRECTUS_SCHEMA_ENTRY,
            schemaBytes: schemaStats.bytes,
            schemaSha256: schemaStats.sha256,
        },
        minio: {
            service: "minio",
            bucket: MINIO_BUCKET,
            objectsRoot: MINIO_OBJECTS_ROOT_ENTRY,
            objectsManifestFile: MINIO_OBJECTS_MANIFEST_ENTRY,
            objectsManifestSha256: objectsManifestStats.sha256,
            objectCount: objectsManifest.length,
        },
        integrity: {
            algorithm: "sha256",
            signed: false,
        },
    };
}

async function exportPackage(outputPath) {
    assertEnv(REQUIRED_ENV_NAMES);
    assertZipPath(outputPath);
    ensureDockerServices();

    await withTempDir("cialli-docker-data-export-", async (tempDir) => {
        const postgresDir = path.join(tempDir, "postgres");
        const directusDir = path.join(tempDir, "directus");
        const minioObjectsDir = path.join(tempDir, MINIO_OBJECTS_ROOT_ENTRY);

        await ensureDir(postgresDir);
        await ensureDir(directusDir);
        await ensureDir(minioObjectsDir);

        await exportPostgresDump(path.join(tempDir, POSTGRES_DUMP_ENTRY));
        await exportDirectusSchema(path.join(tempDir, DIRECTUS_SCHEMA_ENTRY));
        await exportMinioObjects(minioObjectsDir);

        const manifest = await createManifest(tempDir);
        await writeJson(path.join(tempDir, MANIFEST_ENTRY), manifest);
        await verifyExtractedPackage(tempDir);
        await createZipFromDirectory(tempDir, outputPath);
    });

    await verifyPackage(outputPath);
    console.info(`[docker:data:export] 数据包已导出: ${outputPath}`);
}

function copyToContainer(source, target) {
    runDocker(["cp", source, target]);
}

function stopWritableServices() {
    console.info("[docker:data:import] 停止写入服务 web/worker/directus。");
    runDockerCompose(["stop", ...WRITABLE_SERVICES], { stdio: "inherit" });
}

function startWritableServices() {
    console.info("[docker:data:import] 重新启动 directus/web/worker。");
    runDockerCompose(["up", "-d", ...WRITABLE_SERVICES], { stdio: "inherit" });
}

async function restorePostgres(packageDir) {
    console.info("[docker:data:import] 覆盖恢复 PostgreSQL。");
    const dumpPath = path.join(packageDir, POSTGRES_DUMP_ENTRY);
    const postgresContainerId = resolveComposeContainerId("postgres");
    const containerDumpPath = "/tmp/docker-data-import.dump";

    copyToContainer(dumpPath, `${postgresContainerId}:${containerDumpPath}`);

    try {
        runPostgresExec([
            "psql",
            "-U",
            readPostgresUser(),
            "-d",
            readPostgresDatabase(),
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "drop schema if exists public cascade; create schema public;",
        ]);
        runPostgresExec([
            "pg_restore",
            "-U",
            readPostgresUser(),
            "-d",
            readPostgresDatabase(),
            "--clean",
            "--if-exists",
            containerDumpPath,
        ]);
    } finally {
        runPostgresExec(["rm", "-f", containerDumpPath]);
    }
}

async function restoreMinio(packageDir) {
    console.info("[docker:data:import] 清空并恢复 MinIO bucket。");
    const objectsDir = path.join(packageDir, MINIO_OBJECTS_ROOT_ENTRY);
    const minioContainerId = resolveComposeContainerId("minio");
    const containerImportDir = "/tmp/docker-data-import";

    minioShell(
        `rm -rf "${containerImportDir}" && mkdir -p "${containerImportDir}"`,
    );
    copyToContainer(
        `${objectsDir}/.`,
        `${minioContainerId}:${containerImportDir}`,
    );

    try {
        minioShell(
            [
                createMinioAliasCommand(),
                'mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null 2>&1',
                'mc rm --recursive --force "local/$MINIO_BUCKET" >/dev/null 2>&1 || true',
                `mc mirror --overwrite "${containerImportDir}" "local/$MINIO_BUCKET"`,
            ].join(" && "),
        );
    } finally {
        minioShell(`rm -rf "${containerImportDir}"`);
    }
}

function readLiveMinioObjectCount() {
    const output = minioShell(
        [
            createMinioAliasCommand(),
            'mc mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null 2>&1',
            'mc ls --recursive --json "local/$MINIO_BUCKET"',
        ].join(" && "),
    );

    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.type === "file").length;
}

function waitForDirectusHealth() {
    const script =
        "fetch('http://127.0.0.1:8055/server/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))";

    for (let attempt = 1; attempt <= 30; attempt += 1) {
        try {
            runDockerCompose(["exec", "-T", "directus", "node", "-e", script]);
            return;
        } catch {
            runCommand("sleep", ["3"]);
        }
    }

    throw new Error("Directus healthcheck 未在超时时间内恢复");
}

function runPostImportChecks(manifest) {
    console.info("[docker:data:import] 执行导入后轻量校验。");
    runPostgresExec([
        "psql",
        "-U",
        readPostgresUser(),
        "-d",
        readPostgresDatabase(),
        "-At",
        "-c",
        "select 1;",
    ]);
    waitForDirectusHealth();

    const liveObjectCount = readLiveMinioObjectCount();
    if (liveObjectCount !== manifest.minio.objectCount) {
        throw new Error(
            `MinIO 对象数量不一致: live=${liveObjectCount}, package=${manifest.minio.objectCount}`,
        );
    }
}

async function importPackage(zipPath, options = {}) {
    assertEnv(REQUIRED_ENV_NAMES);
    ensureDockerServices();

    const backupOutputPath = options.backupOutputPath || null;
    const noBackup = options.noBackup === true;
    if (noBackup && backupOutputPath) {
        throw new Error("--no-backup 与 --backup-output 不能同时使用");
    }

    const resolvedZipPath = resolveFromRoot(zipPath);
    const resolvedBackupPath = noBackup
        ? null
        : backupOutputPath
          ? resolveFromRoot(backupOutputPath)
          : defaultExportPath("before-docker-data-import");
    assertZipPath(resolvedZipPath);
    if (resolvedBackupPath) {
        assertZipPath(resolvedBackupPath);
    }

    await assertRequiredFile(resolvedZipPath, "待导入 Docker 数据 zip 包");

    await withTempDir("cialli-docker-data-import-", async (packageDir) => {
        await unzipPackage(resolvedZipPath, packageDir);
        const manifest = await verifyExtractedPackage(packageDir);

        if (resolvedBackupPath) {
            console.info(
                "[docker:data:import] 导入前自动备份当前 Docker 数据。",
            );
            await exportPackage(resolvedBackupPath);
            await verifyPackage(resolvedBackupPath);
        } else {
            console.info(
                "[docker:data:import] 已按 --no-backup 跳过导入前备份。",
            );
        }

        let restoreStarted = false;
        try {
            stopWritableServices();
            restoreStarted = true;
            await restorePostgres(packageDir);
            await restoreMinio(packageDir);
            startWritableServices();
            runPostImportChecks(manifest);
            console.info("[docker:data:import] 数据包导入完成。");
            if (resolvedBackupPath) {
                console.info(
                    `[docker:data:import] 导入前备份: ${resolvedBackupPath}`,
                );
            }
        } catch (error) {
            if (restoreStarted) {
                console.error("[docker:data:import] 覆盖导入过程中失败。");
                if (resolvedBackupPath) {
                    console.error(
                        `[docker:data:import] 当前环境的导入前备份保存在: ${resolvedBackupPath}`,
                    );
                    console.error(
                        `[docker:data:import] 如需回滚，请确认原因后执行: pnpm docker:data:import ${resolvedBackupPath}`,
                    );
                } else {
                    console.error(
                        "[docker:data:import] 本次使用 --no-backup，未创建导入前备份，脚本无法提供回滚包。",
                    );
                }
            }
            throw error;
        }
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.command === "help") {
        console.info(usage());
        return;
    }

    if (args.command === "export") {
        const outputPath = args.output
            ? resolveFromRoot(args.output)
            : defaultExportPath();
        await exportPackage(outputPath);
        return;
    }

    if (args.command === "verify") {
        const [zipPath] = args.positional;
        if (!zipPath) {
            throw new Error("verify 需要提供 zip 包路径");
        }
        await verifyPackage(zipPath);
        return;
    }

    if (args.command === "import") {
        const [zipPath] = args.positional;
        if (!zipPath) {
            throw new Error("import 需要提供 zip 包路径");
        }
        await importPackage(zipPath, {
            backupOutputPath: args.backupOutput,
            noBackup: args.noBackup,
        });
        return;
    }

    throw new Error(`未知命令: ${args.command}\n${usage()}`);
}

try {
    await main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
