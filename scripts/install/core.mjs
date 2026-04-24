import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import {
    buildEnvValues,
    generateInstallerSecrets,
    INSTALL_DIRECTUS_ADMIN_ROLE,
    renderEnvFile,
} from "./env.mjs";
import { createInstallerI18n, resolveInstallLanguageChoice } from "./i18n.mjs";
import {
    deriveComposeProjectName,
    detectHostPlatform,
    isPortAvailable,
    REQUIRED_HOST_PORTS,
} from "./host.mjs";
import { resolvePublicBaseUrl } from "../../src/config/public-base-url.mjs";

const execFileAsync = promisify(execFile);
const DIRECTUS_HEALTH_PATH = "/server/health";
const DIRECTUS_WEB_SERVICE_POLICY_NAME = "CiaLli Web Service";
const DIRECTUS_WORKER_SERVICE_POLICY_NAME = "CiaLli Worker Service";

const WEB_SERVICE_PERMISSION_SPECS = [
    ...[
        "app_user_profiles",
        "app_ai_summary_jobs",
        "app_articles",
        "app_article_comments",
        "app_article_comment_likes",
        "app_article_likes",
        "app_diaries",
        "app_diary_images",
        "app_diary_comments",
        "app_diary_comment_likes",
        "app_diary_likes",
        "app_albums",
        "app_album_photos",
        "app_friends",
        "app_user_registration_requests",
        "app_site_settings",
        "app_site_announcements",
    ].flatMap((collection) => [
        { collection, actions: ["read", "create", "update", "delete"] },
    ]),
    {
        collection: "directus_users",
        actions: ["read", "create", "update", "delete"],
    },
    {
        collection: "directus_files",
        actions: ["read", "create", "update", "delete"],
    },
    {
        collection: "directus_comments",
        actions: ["read", "update", "delete"],
    },
    {
        collection: "directus_notifications",
        actions: ["read", "update", "delete"],
    },
    {
        collection: "directus_versions",
        actions: ["read", "update", "delete"],
    },
    { collection: "directus_roles", actions: ["read"] },
    { collection: "directus_policies", actions: ["read"] },
];

const WORKER_SERVICE_PERMISSION_SPECS = [
    { collection: "app_ai_summary_jobs", actions: ["read", "update"] },
    { collection: "app_articles", actions: ["read", "update"] },
    { collection: "app_site_settings", actions: ["read"] },
];

/**
 * @typedef {ReturnType<typeof createInstallerI18n>} InstallTranslator
 */

/**
 * @typedef {{
 *   runCommand: (command: string, args: string[], options?: import('node:child_process').ExecFileOptions) => Promise<string>;
 *   writeFile: (targetPath: string, contents: string) => Promise<void>;
 *   readFile: (targetPath: string) => Promise<string>;
 *   removeFile: (targetPath: string) => Promise<void>;
 *   fileExists: (targetPath: string) => Promise<boolean>;
 *   fetch: typeof fetch;
 *   prompt: (question: string) => Promise<string>;
 *   log: (message: string) => void;
 *   error: (message: string) => void;
 *   portAvailable: (port: number, host: string) => Promise<boolean>;
 *   platform: NodeJS.Platform;
 *   release: string;
 *   cwd: string;
 * }} InstallerDeps
 */

/**
 * @typedef {{
 *   command: "install";
 *   lang: "en" | "zh_CN" | "zh_TW" | "ja" | null;
 *   siteUrl: string | null;
 *   envFile: string | null;
 *   reset: boolean;
 *   interactive: boolean;
 * }} InstallFlowArgs
 */

/**
 * @returns {InstallerDeps}
 */
export function createInstallerDeps() {
    return {
        cwd: process.cwd(),
        platform: process.platform,
        release: os.release(),
        async runCommand(command, args, options = {}) {
            const result = await execFileAsync(command, args, {
                cwd: options.cwd,
                env: options.env,
                encoding: "utf8",
                maxBuffer: 16 * 1024 * 1024,
            });
            return `${result.stdout || ""}${result.stderr || ""}`.trim();
        },
        async writeFile(targetPath, contents) {
            await fs.writeFile(targetPath, contents, "utf8");
        },
        async readFile(targetPath) {
            return await fs.readFile(targetPath, "utf8");
        },
        async removeFile(targetPath) {
            await fs.rm(targetPath, { force: true });
        },
        async fileExists(targetPath) {
            try {
                await fs.access(targetPath);
                return true;
            } catch {
                return false;
            }
        },
        fetch: globalThis.fetch.bind(globalThis),
        async prompt(question) {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            try {
                return (await rl.question(question)).trim();
            } finally {
                rl.close();
            }
        },
        log(message) {
            console.info(message);
        },
        error(message) {
            console.error(message);
        },
        portAvailable: isPortAvailable,
    };
}

/**
 * @param {InstallFlowArgs} args
 * @param {InstallerDeps} deps
 */
export async function runInstallFlow(args, deps) {
    const installLanguage = await resolveInstallLanguage(args, deps);
    const t = createInstallerI18n(installLanguage);
    const projectRoot = await findProjectRoot(deps.cwd, deps, t);
    const envFilePath = path.resolve(projectRoot, args.envFile || ".env");
    const hostPlatform = detectHostPlatform(deps.platform, deps.release);
    if (!hostPlatform) {
        throw new Error(
            t("unsupportedPlatform", {
                platform: deps.platform,
            }),
        );
    }

    const installInput = await resolveInstallInput(args, deps, t);
    const directusUrl = "http://127.0.0.1:8055";
    const composeProjectName = deriveComposeProjectName(projectRoot);

    await ensureDockerPreflight(hostPlatform, projectRoot, deps, t);

    const existingIssues = await detectExistingInstall({
        composeProjectName,
        envFilePath,
        projectRoot,
        deps,
        t,
    });
    if (existingIssues.length > 0 && !args.reset) {
        throw new Error(
            t("existingInstallDetected", {
                reasons: existingIssues.join("; "),
            }),
        );
    }

    if (args.reset) {
        deps.log(t("resetCleanup"));
        if (!(await deps.fileExists(envFilePath))) {
            await deps.writeFile(envFilePath, "");
        }
        await runCompose(
            projectRoot,
            envFilePath,
            ["down", "--volumes", "--remove-orphans"],
            deps,
        );
        await deps.removeFile(envFilePath);
    }

    await ensurePortsAvailable(deps, t);
    await ensureSeedAssets(projectRoot, deps);

    const generatedSecrets = generateInstallerSecrets();
    const envValues = buildEnvValues({
        appPublicBaseUrl: installInput.siteUrl,
        directusUrl,
        publicAssetBaseUrl: "",
        directusWebStaticToken: "",
        directusWorkerStaticToken: "",
        directusAdminEmail: generatedSecrets.DIRECTUS_ADMIN_EMAIL,
        directusAdminPassword: generatedSecrets.DIRECTUS_ADMIN_PASSWORD,
        directusSecret: generatedSecrets.DIRECTUS_SECRET,
        postgresUser: generatedSecrets.POSTGRES_USER,
        postgresDb: generatedSecrets.POSTGRES_DB,
        postgresPassword: generatedSecrets.POSTGRES_PASSWORD,
        minioRootUser: generatedSecrets.MINIO_ROOT_USER,
        minioRootPassword: generatedSecrets.MINIO_ROOT_PASSWORD,
        storageS3Key: generatedSecrets.STORAGE_S3_KEY,
        storageS3Secret: generatedSecrets.STORAGE_S3_SECRET,
        bangumiTokenEncryptionKey:
            generatedSecrets.BANGUMI_TOKEN_ENCRYPTION_KEY,
        aiSummaryInternalSecret: generatedSecrets.AI_SUMMARY_INTERNAL_SECRET,
    });

    await deps.writeFile(envFilePath, renderEnvFile(envValues));

    deps.log(t("buildImages"));
    await runCompose(
        projectRoot,
        envFilePath,
        ["build", "web", "worker"],
        deps,
    );

    deps.log(t("startInfra"));
    await runCompose(
        projectRoot,
        envFilePath,
        [
            "up",
            "-d",
            "postgres",
            "redis",
            "minio",
            "minio-init",
            "seed-postgres-restore",
            "seed-minio-restore",
        ],
        deps,
    );

    deps.log(t("provisionStorage"));
    await createMinioStorageAccount(projectRoot, envFilePath, envValues, deps);

    await runCompose(projectRoot, envFilePath, ["up", "-d", "directus"], deps);
    await waitForHttpOk(`${directusUrl}${DIRECTUS_HEALTH_PATH}`, deps, t);

    deps.log(t("createRole"));
    await runComposeExec(
        projectRoot,
        envFilePath,
        [
            "directus",
            "npx",
            "directus",
            "roles",
            "create",
            "--role",
            INSTALL_DIRECTUS_ADMIN_ROLE,
            "--admin",
            "--app",
        ],
        deps,
    );

    const adminRoleId = (
        await runComposeExec(
            projectRoot,
            envFilePath,
            [
                "postgres",
                "sh",
                "-lc",
                [
                    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c',
                    `"select id from directus_roles where name = '${INSTALL_DIRECTUS_ADMIN_ROLE.replace(/'/g, "''")}' limit 1"`,
                ].join(" "),
            ],
            deps,
        )
    )
        .trim()
        .split("\n")
        .at(-1)
        ?.trim();
    if (!adminRoleId) {
        throw new Error(t("roleIdMissing"));
    }

    deps.log(t("createAdminUser"));
    await runComposeExec(
        projectRoot,
        envFilePath,
        [
            "directus",
            "npx",
            "directus",
            "users",
            "create",
            "--email",
            envValues.DIRECTUS_ADMIN_EMAIL,
            "--password",
            envValues.DIRECTUS_ADMIN_PASSWORD,
            "--role",
            adminRoleId,
        ],
        deps,
    );

    const loginResponse = await deps.fetch(`${directusUrl}/auth/login`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            email: envValues.DIRECTUS_ADMIN_EMAIL,
            password: envValues.DIRECTUS_ADMIN_PASSWORD,
        }),
    });
    if (!loginResponse.ok) {
        throw new Error(
            t("directusAdminLoginFailed", {
                status: loginResponse.status,
            }),
        );
    }
    const loginPayload = await loginResponse.json();
    const accessToken = String(
        loginPayload?.data?.access_token || loginPayload?.access_token || "",
    ).trim();
    if (!accessToken) {
        throw new Error(t("directusAccessTokenMissing"));
    }

    deps.log(t("generateStaticToken"));
    const webPolicyId = await createDirectusPolicy({
        accessToken,
        deps,
        directusUrl,
        name: DIRECTUS_WEB_SERVICE_POLICY_NAME,
        permissionSpecs: WEB_SERVICE_PERMISSION_SPECS,
        t,
    });
    const workerPolicyId = await createDirectusPolicy({
        accessToken,
        deps,
        directusUrl,
        name: DIRECTUS_WORKER_SERVICE_POLICY_NAME,
        permissionSpecs: WORKER_SERVICE_PERMISSION_SPECS,
        t,
    });

    await createDirectusServiceUser({
        accessToken,
        deps,
        directusUrl,
        email: generatedSecrets.DIRECTUS_WEB_SERVICE_EMAIL,
        password: generatedSecrets.DIRECTUS_WEB_SERVICE_PASSWORD,
        policyId: webPolicyId,
        staticToken: generatedSecrets.DIRECTUS_WEB_STATIC_TOKEN,
        t,
        userName: "CiaLli Web Service",
    });
    await createDirectusServiceUser({
        accessToken,
        deps,
        directusUrl,
        email: generatedSecrets.DIRECTUS_WORKER_SERVICE_EMAIL,
        password: generatedSecrets.DIRECTUS_WORKER_SERVICE_PASSWORD,
        policyId: workerPolicyId,
        staticToken: generatedSecrets.DIRECTUS_WORKER_STATIC_TOKEN,
        t,
        userName: "CiaLli Worker Service",
    });

    envValues.DIRECTUS_WEB_STATIC_TOKEN =
        generatedSecrets.DIRECTUS_WEB_STATIC_TOKEN;
    envValues.DIRECTUS_WORKER_STATIC_TOKEN =
        generatedSecrets.DIRECTUS_WORKER_STATIC_TOKEN;
    await deps.writeFile(envFilePath, renderEnvFile(envValues));

    deps.log(t("updateSiteLanguage"));
    await upsertSiteLanguage({
        directusUrl,
        accessToken,
        language: installLanguage,
        deps,
        t,
    });

    deps.log(t("startApp"));
    await runCompose(
        projectRoot,
        envFilePath,
        ["up", "-d", "web", "worker", "proxy"],
        deps,
    );

    deps.log(t("installComplete"));
    for (const line of buildInstallSummary({
        envValues,
        envFilePath,
        siteUrl: installInput.siteUrl,
        directusUrl,
        t,
    })) {
        deps.log(line);
    }

    return {
        envFilePath,
        directusUrl,
        lang: installLanguage,
        siteUrl: installInput.siteUrl,
    };
}

/**
 * @param {InstallFlowArgs} args
 * @param {InstallerDeps} deps
 */
async function resolveInstallLanguage(args, deps) {
    if (args.lang) {
        return args.lang;
    }

    while (true) {
        const choice = resolveInstallLanguageChoice(
            await deps.prompt(createInstallerI18n("zh_CN")("selectLanguage")),
        );
        if (choice) {
            return choice;
        }
        deps.error(
            createInstallerI18n("zh_CN")("selectLanguageRetry", {
                supported: "en, zh_CN, zh_TW, ja",
            }),
        );
    }
}

/**
 * @param {string} startDir
 * @param {InstallerDeps} deps
 * @param {InstallTranslator} t
 * @returns {Promise<string>}
 */
async function findProjectRoot(startDir, deps, t) {
    let current = path.resolve(startDir);
    while (true) {
        const hasPackageJson = await deps.fileExists(
            path.join(current, "package.json"),
        );
        const hasCompose = await deps.fileExists(
            path.join(current, "docker-compose.yml"),
        );
        if (hasPackageJson && hasCompose) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(t("projectRootNotFound"));
        }
        current = parent;
    }
}

/**
 * @param {InstallFlowArgs} args
 * @param {InstallerDeps} deps
 * @param {InstallTranslator} t
 */
async function resolveInstallInput(args, deps, t) {
    let siteUrl = String(args.siteUrl || "").trim();

    if (args.interactive && !siteUrl) {
        siteUrl = await deps.prompt(t("promptSiteUrl"));
    }

    if (!siteUrl) {
        throw new Error(t("siteUrlRequired"));
    }

    try {
        const resolved = resolvePublicBaseUrl({
            APP_PUBLIC_BASE_URL: siteUrl,
        });
        return {
            siteUrl: resolved.origin,
        };
    } catch {
        throw new Error(
            t("unsupportedSiteUrl", {
                siteUrl,
            }),
        );
    }
}

/**
 * @param {"linux" | "macos" | "wsl"} hostPlatform
 * @param {string} projectRoot
 * @param {InstallerDeps} deps
 * @param {InstallTranslator} t
 */
async function ensureDockerPreflight(hostPlatform, projectRoot, deps, t) {
    await deps.runCommand("docker", ["--version"], { cwd: projectRoot });
    await deps.runCommand("docker", ["compose", "version"], {
        cwd: projectRoot,
    });

    try {
        await deps.runCommand("docker", ["info"], { cwd: projectRoot });
    } catch (error) {
        if (hostPlatform === "linux") {
            try {
                await deps.runCommand("systemctl", ["start", "docker"], {
                    cwd: projectRoot,
                });
            } catch {
                await deps.runCommand("service", ["docker", "start"], {
                    cwd: projectRoot,
                });
            }
            await deps.runCommand("docker", ["info"], { cwd: projectRoot });
            return;
        }
        throw new Error(t("dockerDaemonUnavailable"), { cause: error });
    }
}

/**
 * @param {InstallerDeps} deps
 * @param {InstallTranslator} t
 */
async function ensurePortsAvailable(deps, t) {
    for (const entry of REQUIRED_HOST_PORTS) {
        const available = await deps.portAvailable(entry.port, entry.host);
        if (!available) {
            throw new Error(
                t("portUnavailable", {
                    label: entry.label,
                    host: entry.host,
                    port: entry.port,
                }),
            );
        }
    }
}

/**
 * @param {string} projectRoot
 * @param {InstallerDeps} deps
 */
async function ensureSeedAssets(projectRoot, deps) {
    await deps.runCommand("git", ["lfs", "version"], { cwd: projectRoot });
    await deps.runCommand("node", ["scripts/seed/verify.mjs"], {
        cwd: projectRoot,
        env: {
            ...process.env,
            SEED_VERIFY_SKIP_RESTORE: "1",
        },
    });
}

/**
 * @param {{
 *   composeProjectName: string;
 *   envFilePath: string;
 *   projectRoot: string;
 *   deps: InstallerDeps;
 *   t: InstallTranslator;
 * }} params
 */
async function detectExistingInstall(params) {
    /** @type {string[]} */
    const reasons = [];
    if (await params.deps.fileExists(params.envFilePath)) {
        reasons.push(
            params.t("envFileDetected", {
                name: path.basename(params.envFilePath),
            }),
        );
    }

    const containerIds = (
        await runCompose(
            params.projectRoot,
            params.envFilePath,
            ["ps", "-aq"],
            params.deps,
        ).catch(() => "")
    )
        .split(/\s+/)
        .filter(Boolean);
    if (containerIds.length > 0) {
        reasons.push(params.t("composeContainerDetected"));
    }

    const volumeList = await params.deps
        .runCommand(
            "docker",
            [
                "volume",
                "ls",
                "--filter",
                `label=com.docker.compose.project=${params.composeProjectName}`,
                "--format",
                "{{.Name}}",
            ],
            { cwd: params.projectRoot },
        )
        .catch(() => "");
    if (volumeList.split(/\s+/).filter(Boolean).length > 0) {
        reasons.push(params.t("composeVolumesDetected"));
    }
    return reasons;
}

/**
 * @param {string} url
 * @param {InstallerDeps} deps
 * @param {InstallTranslator} t
 */
async function waitForHttpOk(url, deps, t) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await deps.fetch(url);
            if (response.ok) {
                return;
            }
        } catch {
            // ignore until timeout
        }
        await sleep(1000);
    }
    throw new Error(
        t("waitForHealthTimeout", {
            url,
        }),
    );
}

/**
 * @param {{
 *   directusUrl: string;
 *   accessToken: string;
 *   language: "en" | "zh_CN" | "zh_TW" | "ja";
 *   deps: InstallerDeps;
 *   t: InstallTranslator;
 * }} params
 */
async function upsertSiteLanguage(params) {
    const query = new URLSearchParams({
        limit: "1",
        fields: "id,settings_site",
        "filter[key][_eq]": "default",
    });
    const readResponse = await params.deps.fetch(
        `${params.directusUrl}/items/app_site_settings?${query.toString()}`,
        {
            headers: {
                authorization: `Bearer ${params.accessToken}`,
            },
        },
    );
    if (!readResponse.ok) {
        throw new Error(
            params.t("siteLanguageReadFailed", {
                status: readResponse.status,
            }),
        );
    }

    const readPayload = await readResponse.json();
    const existingRow = Array.isArray(readPayload?.data)
        ? readPayload.data[0] || null
        : null;
    const nextSettingsSite = mergeSiteLanguage(
        existingRow?.settings_site,
        params.language,
    );

    if (!existingRow) {
        params.deps.log(params.t("siteSettingsMissingTitle"));
    }

    const writeResponse = await params.deps.fetch(
        existingRow
            ? `${params.directusUrl}/items/app_site_settings/${existingRow.id}`
            : `${params.directusUrl}/items/app_site_settings`,
        {
            method: existingRow ? "PATCH" : "POST",
            headers: {
                authorization: `Bearer ${params.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(
                existingRow
                    ? {
                          settings_site: nextSettingsSite,
                      }
                    : {
                          key: "default",
                          status: "published",
                          theme_preset: "purple",
                          settings_site: nextSettingsSite,
                      },
            ),
        },
    );
    if (!writeResponse.ok) {
        throw new Error(
            params.t("siteLanguageWriteFailed", {
                status: writeResponse.status,
            }),
        );
    }
}

/**
 * @param {string} projectRoot
 * @param {string} envFilePath
 * @param {Record<string, string>} envValues
 * @param {InstallerDeps} deps
 */
async function createMinioStorageAccount(
    projectRoot,
    envFilePath,
    envValues,
    deps,
) {
    const script = [
        'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1',
        'if mc admin user svcacct info local "$STORAGE_S3_KEY" >/dev/null 2>&1; then exit 0; fi',
        'mc admin user svcacct add local "$MINIO_ROOT_USER" --access-key "$STORAGE_S3_KEY" --secret-key "$STORAGE_S3_SECRET" >/dev/null',
    ].join(" && ");

    await deps.runCommand(
        "docker",
        [
            "compose",
            "--env-file",
            envFilePath,
            "-f",
            "docker-compose.yml",
            "exec",
            "-T",
            "-e",
            `STORAGE_S3_KEY=${envValues.STORAGE_S3_KEY}`,
            "-e",
            `STORAGE_S3_SECRET=${envValues.STORAGE_S3_SECRET}`,
            "minio",
            "sh",
            "-lc",
            script,
        ],
        { cwd: projectRoot },
    );
}

/**
 * @param {unknown} settingsSite
 * @param {"en" | "zh_CN" | "zh_TW" | "ja"} language
 */
function mergeSiteLanguage(settingsSite, language) {
    const current = isRecord(settingsSite) ? structuredClone(settingsSite) : {};
    const currentSite = isRecord(current.site) ? current.site : {};
    return {
        ...current,
        site: {
            ...currentSite,
            lang: language,
        },
    };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{
 *   envValues: Record<string, string>;
 *   envFilePath: string;
 *   siteUrl: string;
 *   directusUrl: string;
 *   t: InstallTranslator;
 * }} params
 */
function buildInstallSummary(params) {
    const sections = [
        {
            title: params.t("sectionPublicEntry"),
            keys: ["APP_PUBLIC_BASE_URL", "PUBLIC_ASSET_BASE_URL"],
        },
        {
            title: params.t("sectionDirectus"),
            keys: [
                "DIRECTUS_URL",
                "DIRECTUS_WEB_STATIC_TOKEN",
                "DIRECTUS_WORKER_STATIC_TOKEN",
                "DIRECTUS_SECRET",
            ],
        },
        {
            title: params.t("sectionDataServices"),
            keys: [
                "POSTGRES_USER",
                "POSTGRES_DB",
                "POSTGRES_PASSWORD",
                "REDIS_URL",
                "MINIO_ROOT_USER",
                "MINIO_ROOT_PASSWORD",
            ],
        },
        {
            title: params.t("sectionAdminBootstrap"),
            keys: ["DIRECTUS_ADMIN_EMAIL", "DIRECTUS_ADMIN_PASSWORD"],
        },
        {
            title: params.t("sectionStorage"),
            keys: ["STORAGE_S3_KEY", "STORAGE_S3_SECRET"],
        },
        {
            title: params.t("sectionAppSecrets"),
            keys: [
                "BANGUMI_TOKEN_ENCRYPTION_KEY",
                "AI_SUMMARY_INTERNAL_SECRET",
            ],
        },
    ];

    /** @type {string[]} */
    const lines = [params.t("configSummaryTitle")];
    for (const section of sections) {
        lines.push(`[install] ${section.title}`);
        for (const key of section.keys) {
            lines.push(`[install]   ${key}=${params.envValues[key] || ""}`);
        }
    }
    lines.push(
        params.t("envFileWritten", {
            path: params.envFilePath,
        }),
    );
    lines.push(
        params.t("siteEntry", {
            url: params.siteUrl,
        }),
    );
    lines.push(
        params.t("directusEntry", {
            url: params.directusUrl,
        }),
    );
    lines.push(params.t("envViewHint"));
    return lines;
}

/**
 * @param {{
 *   accessToken: string;
 *   deps: InstallerDeps;
 *   directusUrl: string;
 *   name: string;
 *   permissionSpecs: Array<{ collection: string; actions: string[] }>;
 *   t: InstallTranslator;
 * }} params
 * @returns {Promise<string>}
 */
async function createDirectusPolicy(params) {
    const policyResponse = await params.deps.fetch(
        `${params.directusUrl}/policies`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${params.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                name: params.name,
                description: `${params.name} service access policy`,
                admin_access: false,
                app_access: false,
            }),
        },
    );
    if (!policyResponse.ok) {
        throw new Error(
            params.t("directusStaticTokenPersistFailed", {
                status: policyResponse.status,
            }),
        );
    }
    const policyPayload = await policyResponse.json();
    const policyId = String(policyPayload?.data?.id || "").trim();
    if (!policyId) {
        throw new Error(params.t("directusAdminUserIdMissing"));
    }

    for (const spec of params.permissionSpecs) {
        for (const action of spec.actions) {
            const permissionResponse = await params.deps.fetch(
                `${params.directusUrl}/permissions`,
                {
                    method: "POST",
                    headers: {
                        authorization: `Bearer ${params.accessToken}`,
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({
                        policy: policyId,
                        collection: spec.collection,
                        action,
                        permissions: {},
                        validation: {},
                        presets: {},
                        fields: ["*"],
                    }),
                },
            );
            if (!permissionResponse.ok) {
                throw new Error(
                    params.t("directusStaticTokenPersistFailed", {
                        status: permissionResponse.status,
                    }),
                );
            }
        }
    }

    return policyId;
}

/**
 * @param {{
 *   accessToken: string;
 *   deps: InstallerDeps;
 *   directusUrl: string;
 *   email: string;
 *   password: string;
 *   policyId: string;
 *   staticToken: string;
 *   t: InstallTranslator;
 *   userName: string;
 * }} params
 * @returns {Promise<void>}
 */
async function createDirectusServiceUser(params) {
    const createResponse = await params.deps.fetch(
        `${params.directusUrl}/users`,
        {
            method: "POST",
            headers: {
                authorization: `Bearer ${params.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                email: params.email,
                password: params.password,
                status: "active",
                first_name: params.userName,
            }),
        },
    );
    if (!createResponse.ok) {
        throw new Error(
            params.t("directusStaticTokenPersistFailed", {
                status: createResponse.status,
            }),
        );
    }
    const createPayload = await createResponse.json();
    const userId = String(createPayload?.data?.id || "").trim();
    if (!userId) {
        throw new Error(params.t("directusAdminUserIdMissing"));
    }

    const updateResponse = await params.deps.fetch(
        `${params.directusUrl}/users/${encodeURIComponent(userId)}`,
        {
            method: "PATCH",
            headers: {
                authorization: `Bearer ${params.accessToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                token: params.staticToken,
                policies: {
                    create: [{ policy: params.policyId }],
                },
            }),
        },
    );
    if (!updateResponse.ok) {
        throw new Error(
            params.t("directusStaticTokenPersistFailed", {
                status: updateResponse.status,
            }),
        );
    }
}

/**
 * @param {string} projectRoot
 * @param {string} envFilePath
 * @param {string[]} composeArgs
 * @param {InstallerDeps} deps
 */
async function runCompose(projectRoot, envFilePath, composeArgs, deps) {
    return await deps.runCommand(
        "docker",
        [
            "compose",
            "--env-file",
            envFilePath,
            "-f",
            "docker-compose.yml",
            ...composeArgs,
        ],
        { cwd: projectRoot },
    );
}

/**
 * @param {string} projectRoot
 * @param {string} envFilePath
 * @param {string[]} execArgs
 * @param {InstallerDeps} deps
 */
async function runComposeExec(projectRoot, envFilePath, execArgs, deps) {
    return await runCompose(
        projectRoot,
        envFilePath,
        ["exec", "-T", ...execArgs],
        deps,
    );
}
