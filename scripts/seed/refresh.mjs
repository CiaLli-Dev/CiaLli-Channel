#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import {
    assertEnv,
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD,
    DIRECTUS_SCHEMA_PATH,
    dockerCopyFromContainer,
    ensureDir,
    listFilesRecursive,
    readEnv,
    resolveComposeContainerId,
    resetDir,
    ROOT_DIR,
    runCommand,
    runDockerCompose,
    SEED_METADATA_PATH,
    SEED_MINIO_DIR,
    SEED_POSTGRES_DIR,
    SEED_POSTGRES_DUMP_PATH,
    withTempDir,
    writeJson,
} from "./common.mjs";

const REQUIRED_ENV_NAMES = [
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_BUCKET",
];

const DIRECTUS_ASSET_ID_SOURCE =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const DIRECTUS_ASSET_ID_PATTERN = new RegExp(DIRECTUS_ASSET_ID_SOURCE, "i");
const RELATIVE_PUBLIC_ASSET_PATTERN = new RegExp(
    `(?:https?:\\/\\/[^\\s"'()\\]]+)?\\/api\\/v1\\/public\\/assets\\/(${DIRECTUS_ASSET_ID_SOURCE})(?=[/?#)"'\\]\\s]|$)`,
    "gi",
);
const RELATIVE_PRIVATE_ASSET_PATTERN = new RegExp(
    `(?:https?:\\/\\/[^\\s"'()\\]]+)?\\/api\\/v1\\/assets\\/(${DIRECTUS_ASSET_ID_SOURCE})(?=[/?#)"'\\]\\s]|$)`,
    "gi",
);

const STRUCTURED_REFERENCE_QUERIES = [
    "select header_file as value from app_user_profiles",
    "select avatar as value from directus_users",
    "select cover_file as value from app_articles",
    "select cover_file as value from app_albums",
    "select avatar_file as value from app_friends",
    "select file_id as value from app_album_photos",
    "select file_id as value from app_diary_images",
    "select avatar_file as value from app_user_registration_requests",
];

const MARKDOWN_REFERENCE_QUERIES = [
    "select body_markdown as value from app_articles",
    "select body as value from app_article_comments",
    "select body as value from app_diary_comments",
    "select content as value from app_diaries",
    "select body_markdown as value from app_site_announcements",
];

function buildTempDatabaseName() {
    return `seed_refresh_${Date.now()}`;
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

function escapeSqlLiteral(value) {
    return String(value).replaceAll("'", "''");
}

function normalizeDirectusFileId(value) {
    if (!value) {
        return null;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized || !DIRECTUS_ASSET_ID_PATTERN.test(normalized)) {
            return null;
        }
        return normalized;
    }
    if (typeof value === "object") {
        return normalizeDirectusFileId(value.id);
    }
    return null;
}

function collectAssetIdsFromString(value, output) {
    const patterns = [
        RELATIVE_PUBLIC_ASSET_PATTERN,
        RELATIVE_PRIVATE_ASSET_PATTERN,
    ];

    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match = pattern.exec(value);
        while (match) {
            const fileId = normalizeDirectusFileId(match[1]);
            if (fileId) {
                output.add(fileId);
            }
            match = pattern.exec(value);
        }
    }
}

function collectReferencedAssetIdsFromUnknown(value, output) {
    if (typeof value === "string") {
        collectAssetIdsFromString(value, output);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectReferencedAssetIdsFromUnknown(item, output);
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            collectReferencedAssetIdsFromUnknown(item, output);
        }
    }
}

function extractDirectusAssetIdsFromMarkdown(value) {
    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    const found = new Set();
    collectAssetIdsFromString(value, found);
    return [...found];
}

function buildJsonAggregateQuery(sql) {
    return `select coalesce(json_agg(row_to_json(rows)), '[]'::json)::text from (${sql}) rows`;
}

function readTempDatabaseScalar(tempDatabaseName, sql) {
    return runPostgresExec([
        "psql",
        "-U",
        readEnv("POSTGRES_USER"),
        "-d",
        tempDatabaseName,
        "-At",
        "-c",
        sql,
    ]).trim();
}

function readTempDatabaseJson(tempDatabaseName, sql) {
    const output = readTempDatabaseScalar(
        tempDatabaseName,
        buildJsonAggregateQuery(sql),
    );
    if (!output) {
        return [];
    }
    return JSON.parse(output);
}

function loadDefaultSiteSettingsStorageSnapshot() {
    const script = `
        import { defaultSiteSettings } from "./src/config/index.ts";
        import { LinkPresets } from "./src/constants/link-presets.ts";
        import { splitSiteSettingsForStorage } from "./src/server/site-settings/storage-sections.ts";

        function resolveNavLink(link) {
            if (typeof link === "number") {
                return structuredClone(LinkPresets[link]);
            }
            const next = structuredClone(link);
            if (Array.isArray(next.children)) {
                next.children = next.children.map((child) => resolveNavLink(child));
            }
            return next;
        }

        const normalizedSettings = structuredClone(defaultSiteSettings);
        normalizedSettings.navBar.links = normalizedSettings.navBar.links.map((link) =>
            resolveNavLink(link),
        );

        const storedSections = splitSiteSettingsForStorage(normalizedSettings);
        process.stdout.write(JSON.stringify({
            theme_preset: normalizedSettings.site.themePreset,
            ...storedSections,
        }));
    `;
    const output = runCommand("pnpm", ["exec", "tsx", "--eval", script], {
        cwd: ROOT_DIR,
    }).trim();
    return JSON.parse(output);
}

function createSanitizeSql(selectedAdminId, defaultSiteSettingsStorage) {
    const escapedAdminId = escapeSqlLiteral(selectedAdminId);
    const escapedDemoEmail = escapeSqlLiteral(DEMO_ADMIN_EMAIL);
    const escapedStaticToken = escapeSqlLiteral(
        readEnv("DIRECTUS_STATIC_TOKEN"),
    );
    const escapedThemePreset = escapeSqlLiteral(
        defaultSiteSettingsStorage.theme_preset,
    );
    const escapedSettingsSite = escapeSqlLiteral(
        JSON.stringify(defaultSiteSettingsStorage.settings_site),
    );
    const escapedSettingsNav = escapeSqlLiteral(
        JSON.stringify(defaultSiteSettingsStorage.settings_nav),
    );
    const escapedSettingsHome = escapeSqlLiteral(
        JSON.stringify(defaultSiteSettingsStorage.settings_home),
    );
    const escapedSettingsArticle = escapeSqlLiteral(
        JSON.stringify(defaultSiteSettingsStorage.settings_article),
    );
    const escapedSettingsOther = escapeSqlLiteral(
        JSON.stringify(defaultSiteSettingsStorage.settings_other),
    );

    return `
        -- 文章与联动数据全部从临时副本中裁掉，避免演示 seed 携带真实内容样本。
        delete from app_ai_summary_jobs;
        delete from app_article_comment_likes;
        delete from app_article_comments;
        delete from app_article_likes;
        delete from app_articles;

        -- 非保留管理员用户的派生数据直接收敛，确保 dump 中只剩一套后台账号。
        delete from app_user_registration_requests;
        delete from directus_notifications
        where (recipient is not null and recipient <> '${escapedAdminId}'::uuid)
           or (sender is not null and sender <> '${escapedAdminId}'::uuid);
        delete from directus_sessions
        where "user" <> '${escapedAdminId}'::uuid;
        delete from directus_access
        where "user" <> '${escapedAdminId}'::uuid;
        delete from directus_presets
        where "user" <> '${escapedAdminId}'::uuid;
        delete from app_user_profiles
        where user_id <> '${escapedAdminId}'::uuid;

        update directus_files
        set uploaded_by = case
                when uploaded_by is not null and uploaded_by <> '${escapedAdminId}'::uuid
                    then '${escapedAdminId}'::uuid
                else uploaded_by
            end,
            modified_by = case
                when modified_by is not null and modified_by <> '${escapedAdminId}'::uuid
                    then '${escapedAdminId}'::uuid
                else modified_by
            end,
            app_owner_user_id = case
                when app_owner_user_id is not null and app_owner_user_id <> '${escapedAdminId}'::uuid
                    then '${escapedAdminId}'::uuid
                else app_owner_user_id
            end;

        -- 统一演示后台账号，避免 seed 恢复后出现“账号存在但密码未知”的情况。
        update directus_users
        set email = '${escapedDemoEmail}',
            status = 'active',
            provider = 'default',
            tfa_secret = null,
            token = '${escapedStaticToken}',
            auth_data = null,
            external_identifier = null
        where id = '${escapedAdminId}'::uuid;

        delete from directus_users
        where id <> '${escapedAdminId}'::uuid;

        -- 站点设置保留 default 这一条，但内容回写为代码默认值，避免 seed 固化当前演示定制。
        delete from app_site_settings
        where key <> 'default';

        update app_site_settings
        set status = 'published',
            theme_preset = '${escapedThemePreset}',
            settings_site = '${escapedSettingsSite}'::json,
            settings_nav = '${escapedSettingsNav}'::json,
            settings_home = '${escapedSettingsHome}'::json,
            settings_article = '${escapedSettingsArticle}'::json,
            settings_other = '${escapedSettingsOther}'::json
        where key = 'default';
    `;
}

function readAdminSelectionSql() {
    const currentAdminEmail = escapeSqlLiteral(readEnv("DIRECTUS_ADMIN_EMAIL"));
    const escapedDemoEmail = escapeSqlLiteral(DEMO_ADMIN_EMAIL);

    return `
        select coalesce(
            (
                select id::text
                from directus_users
                where email = '${escapedDemoEmail}'
                limit 1
            ),
            (
                select id::text
                from directus_users
                where email = '${currentAdminEmail}'
                limit 1
            ),
            (
                select u.id::text
                from directus_users u
                left join directus_roles r on r.id = u.role
                where r.name = 'Administrator'
                order by u.email, u.id
                limit 1
            ),
            (
                select id::text
                from directus_users
                order by email, id
                limit 1
            )
        );
    `;
}

function collectReferencedFileIds(tempDatabaseName, directusFiles) {
    const candidateIds = new Set(
        directusFiles
            .map((row) => normalizeDirectusFileId(row.id))
            .filter(Boolean),
    );
    const referencedIds = new Set();

    if (candidateIds.size === 0) {
        return referencedIds;
    }

    const siteSettingsRows = readTempDatabaseJson(
        tempDatabaseName,
        `
            select settings_site,
                   settings_nav,
                   settings_home,
                   settings_article,
                   settings_other
            from app_site_settings
            where key = 'default'
            order by date_updated desc nulls last, date_created desc nulls last
            limit 1
        `,
    );
    for (const row of siteSettingsRows) {
        for (const value of Object.values(row)) {
            collectReferencedAssetIdsFromUnknown(value, referencedIds);
        }
    }

    for (const sql of STRUCTURED_REFERENCE_QUERIES) {
        const rows = readTempDatabaseJson(tempDatabaseName, sql);
        for (const row of rows) {
            const fileId = normalizeDirectusFileId(row.value);
            if (fileId && candidateIds.has(fileId)) {
                referencedIds.add(fileId);
            }
        }
    }

    for (const sql of MARKDOWN_REFERENCE_QUERIES) {
        const rows = readTempDatabaseJson(tempDatabaseName, sql);
        for (const row of rows) {
            for (const fileId of extractDirectusAssetIdsFromMarkdown(
                row.value,
            )) {
                if (candidateIds.has(fileId)) {
                    referencedIds.add(fileId);
                }
            }
        }
    }

    return referencedIds;
}

function buildUuidInClause(ids) {
    return ids.map((id) => `'${escapeSqlLiteral(id)}'::uuid`).join(", ");
}

function pruneOrphanDirectusFiles(tempDatabaseName) {
    const directusFiles = readTempDatabaseJson(
        tempDatabaseName,
        `
            select id, storage, filename_disk
            from directus_files
            order by id
        `,
    );
    const referencedIds = collectReferencedFileIds(
        tempDatabaseName,
        directusFiles,
    );
    const keptIds = [...referencedIds].sort();

    // 这里先算出清洗后仍被引用的文件，再删除 orphan 记录，保证 dump 与对象快照始终一致。
    if (keptIds.length === 0) {
        runPostgresExec([
            "psql",
            "-U",
            readEnv("POSTGRES_USER"),
            "-d",
            tempDatabaseName,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "delete from directus_files;",
        ]);
        return [];
    }

    runPostgresExec([
        "psql",
        "-U",
        readEnv("POSTGRES_USER"),
        "-d",
        tempDatabaseName,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `
            delete from directus_files
            where id not in (${buildUuidInClause(keptIds)});
        `,
    ]);

    return readTempDatabaseJson(
        tempDatabaseName,
        `
            select id, storage, filename_disk
            from directus_files
            where storage = 's3'
            order by id
        `,
    );
}

function readMinioBucketEntries() {
    const output = runDockerCompose([
        "exec",
        "-T",
        "-e",
        `MINIO_BUCKET=${readEnv("MINIO_BUCKET")}`,
        "minio",
        "sh",
        "-lc",
        [
            'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1',
            'mc ls --recursive --json "local/$MINIO_BUCKET"',
        ].join(" && "),
    ]);

    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.type === "file");
}

function collectSeedObjectPaths(keptFiles) {
    const bucketEntries = readMinioBucketEntries();
    const keptPrefixes = new Set(
        keptFiles.map((row) => normalizeDirectusFileId(row.id)).filter(Boolean),
    );
    const bucketPrefix = `${readEnv("MINIO_BUCKET")}/`;

    return bucketEntries
        .map((entry) => {
            const key = String(entry.key || "");
            const objectPath = key.startsWith(bucketPrefix)
                ? key.slice(bucketPrefix.length)
                : key;
            return {
                objectPath,
                basename: path.basename(objectPath),
            };
        })
        .filter((entry) => {
            for (const prefix of keptPrefixes) {
                if (entry.basename.startsWith(prefix)) {
                    return true;
                }
            }
            return false;
        })
        .map((entry) => entry.objectPath)
        .sort();
}

async function exportMinioObjects(keptFiles) {
    console.info("[seed:refresh] 导出演示对象存储快照。");
    await resetDir(SEED_MINIO_DIR);

    const keptObjectPaths = collectSeedObjectPaths(keptFiles);
    if (keptObjectPaths.length === 0) {
        return;
    }

    await withTempDir("cialli-seed-minio-", async (tempDir) => {
        const manifestPath = path.join(tempDir, "kept-objects.txt");
        await fs.writeFile(
            manifestPath,
            `${keptObjectPaths.join("\n")}\n`,
            "utf8",
        );

        const minioContainerId = resolveComposeContainerId("minio");
        const containerManifestPath = "/tmp/seed-export-objects.txt";
        dockerCopyFromContainer(
            manifestPath,
            `${minioContainerId}:${containerManifestPath}`,
        );

        try {
            runDockerCompose([
                "exec",
                "-T",
                "-e",
                `MINIO_BUCKET=${readEnv("MINIO_BUCKET")}`,
                "minio",
                "sh",
                "-lc",
                [
                    "rm -rf /tmp/seed-export",
                    "mkdir -p /tmp/seed-export",
                    'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1',
                    "while IFS= read -r object_path; do " +
                        '[ -n "$object_path" ] || continue; ' +
                        'mkdir -p "$(dirname "/tmp/seed-export/$object_path")"; ' +
                        'mc cp "local/$MINIO_BUCKET/$object_path" "/tmp/seed-export/$object_path"; ' +
                        `done < "${containerManifestPath}"`,
                ].join(" && "),
            ]);

            dockerCopyFromContainer(
                `${minioContainerId}:/tmp/seed-export/.`,
                SEED_MINIO_DIR,
            );
        } finally {
            runDockerCompose([
                "exec",
                "-T",
                "minio",
                "sh",
                "-lc",
                `rm -rf /tmp/seed-export "${containerManifestPath}"`,
            ]);
        }
    });
}

async function exportSanitizedDatabase(defaultSiteSettingsStorage) {
    console.info(
        "[seed:refresh] 导出当前 PostgreSQL，并在临时副本上做 seed 清洗。",
    );
    await ensureDir(SEED_POSTGRES_DIR);

    return await withTempDir("cialli-seed-", async (tempDir) => {
        const rawDumpPath = path.join(tempDir, "source.dump");
        const rawDumpBuffer = runPostgresExec(
            [
                "pg_dump",
                "-U",
                readEnv("POSTGRES_USER"),
                "-d",
                readEnv("POSTGRES_DB"),
                "-Fc",
            ],
            { encoding: null },
        );
        await fs.writeFile(rawDumpPath, rawDumpBuffer);

        const postgresContainerId = resolveComposeContainerId("postgres");
        const tempDatabaseName = buildTempDatabaseName();
        const tempDumpContainerPath = `/tmp/${tempDatabaseName}.dump`;

        dockerCopyFromContainer(
            rawDumpPath,
            `${postgresContainerId}:${tempDumpContainerPath}`,
        );

        try {
            runPostgresExec([
                "sh",
                "-lc",
                [
                    `dropdb --if-exists -U "${readEnv("POSTGRES_USER")}" "${tempDatabaseName}"`,
                    `createdb -U "${readEnv("POSTGRES_USER")}" "${tempDatabaseName}"`,
                    `pg_restore -U "${readEnv("POSTGRES_USER")}" -d "${tempDatabaseName}" --clean --if-exists "${tempDumpContainerPath}"`,
                ].join(" && "),
            ]);

            const selectedAdminId = readTempDatabaseScalar(
                tempDatabaseName,
                readAdminSelectionSql(),
            );

            if (!selectedAdminId) {
                throw new Error(
                    "临时数据库中未找到可重置的 Directus 管理员账号。",
                );
            }

            runPostgresExec([
                "psql",
                "-U",
                readEnv("POSTGRES_USER"),
                "-d",
                tempDatabaseName,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                createSanitizeSql(selectedAdminId, defaultSiteSettingsStorage),
            ]);

            const keptFiles = pruneOrphanDirectusFiles(tempDatabaseName);

            runDockerCompose([
                "exec",
                "-T",
                "-e",
                `DB_DATABASE=${tempDatabaseName}`,
                "-e",
                `DB_USER=${readEnv("POSTGRES_USER")}`,
                "-e",
                `DB_PASSWORD=${readEnv("POSTGRES_PASSWORD")}`,
                "directus",
                "npx",
                "directus",
                "users",
                "passwd",
                "--email",
                DEMO_ADMIN_EMAIL,
                "--password",
                DEMO_ADMIN_PASSWORD,
            ]);

            const sanitizedDumpBuffer = runPostgresExec(
                [
                    "pg_dump",
                    "-U",
                    readEnv("POSTGRES_USER"),
                    "-d",
                    tempDatabaseName,
                    "-Fc",
                ],
                { encoding: null },
            );
            await fs.writeFile(SEED_POSTGRES_DUMP_PATH, sanitizedDumpBuffer);

            return keptFiles;
        } finally {
            runPostgresExec(
                [
                    "sh",
                    "-lc",
                    [
                        `dropdb --if-exists -U "${readEnv("POSTGRES_USER")}" "${tempDatabaseName}"`,
                        `rm -f "${tempDumpContainerPath}"`,
                    ].join(" ; "),
                ],
                { stdio: ["pipe", "pipe", "pipe"] },
            );
        }
    });
}

async function writeMetadata() {
    const minioFiles = await listFilesRecursive(SEED_MINIO_DIR);
    const dumpStat = await fs.stat(SEED_POSTGRES_DUMP_PATH);

    await writeJson(SEED_METADATA_PATH, {
        generatedAt: new Date().toISOString(),
        source: "local-docker-compose",
        postgres: {
            service: "postgres",
            database: readEnv("POSTGRES_DB"),
            dumpFile: path.relative(ROOT_DIR, SEED_POSTGRES_DUMP_PATH),
            dumpBytes: dumpStat.size,
        },
        minio: {
            service: "minio",
            bucket: readEnv("MINIO_BUCKET"),
            objectRoot: path.relative(ROOT_DIR, SEED_MINIO_DIR),
            objectCount: minioFiles.length,
        },
        directus: {
            demoAdminEmail: DEMO_ADMIN_EMAIL,
            schemaFile: path.relative(ROOT_DIR, DIRECTUS_SCHEMA_PATH),
        },
        restorePolicy: {
            postgres: "仅在空库或未完成业务初始化时恢复，不覆盖现有数据。",
            minio: "仅在目标 bucket 为空时恢复，不覆盖现有对象。",
        },
        sanitized: {
            aiSettingsCleared: true,
            adminPasswordReset: true,
            contentPruned: true,
            orphanAssetsRemoved: true,
            siteSettingsResetToDefault: true,
        },
    });
}

async function main() {
    assertEnv(REQUIRED_ENV_NAMES);
    const defaultSiteSettingsStorage = loadDefaultSiteSettingsStorageSnapshot();
    const keptFiles = await exportSanitizedDatabase(defaultSiteSettingsStorage);
    await exportMinioObjects(keptFiles);

    console.info("[seed:refresh] 刷新 Directus schema 快照。");
    runCommand("pnpm", ["seed:snapshot"], {
        cwd: ROOT_DIR,
        stdio: "inherit",
    });

    await writeMetadata();
    console.info("[seed:refresh] 演示 seed 已刷新完成。");
}

await main();
