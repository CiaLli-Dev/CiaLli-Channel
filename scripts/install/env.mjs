import { randomBytes } from "node:crypto";

export const INSTALL_DIRECTUS_ADMIN_ROLE = "CiaLli Administrator";
export const DEFAULT_INSTALL_POSTGRES_DB = "directus";
export const DEFAULT_INSTALL_ADMIN_EMAIL = "admin@example.com";

export const INSTALL_ENV_KEYS = [
    "APP_PUBLIC_BASE_URL",
    "PUBLIC_ASSET_BASE_URL",
    "DIRECTUS_URL",
    "DIRECTUS_WEB_STATIC_TOKEN",
    "DIRECTUS_WORKER_STATIC_TOKEN",
    "DIRECTUS_SECRET",
    "POSTGRES_USER",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "REDIS_URL",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "DIRECTUS_ADMIN_EMAIL",
    "DIRECTUS_ADMIN_PASSWORD",
    "STORAGE_S3_KEY",
    "STORAGE_S3_SECRET",
    "APP_SECRET_ENCRYPTION_KEY",
    "AI_SUMMARY_INTERNAL_SECRET",
];

/**
 * @param {(size: number) => Buffer} [random]
 * @returns {{
 *   DIRECTUS_SECRET: string;
 *   POSTGRES_USER: string;
 *   POSTGRES_DB: string;
 *   POSTGRES_PASSWORD: string;
 *   MINIO_ROOT_USER: string;
 *   MINIO_ROOT_PASSWORD: string;
 *   DIRECTUS_ADMIN_EMAIL: string;
 *   DIRECTUS_ADMIN_PASSWORD: string;
 *   STORAGE_S3_KEY: string;
 *   STORAGE_S3_SECRET: string;
 *   AI_SUMMARY_INTERNAL_SECRET: string;
 *   APP_SECRET_ENCRYPTION_KEY: string;
 *   DIRECTUS_WEB_STATIC_TOKEN: string;
 *   DIRECTUS_WORKER_STATIC_TOKEN: string;
 *   DIRECTUS_WEB_SERVICE_EMAIL: string;
 *   DIRECTUS_WEB_SERVICE_PASSWORD: string;
 *   DIRECTUS_WORKER_SERVICE_EMAIL: string;
 *   DIRECTUS_WORKER_SERVICE_PASSWORD: string;
 * }}
 */
export function generateInstallerSecrets(random = randomBytes) {
    const suffix = random(4).toString("hex");
    return {
        DIRECTUS_SECRET: random(32).toString("hex"),
        POSTGRES_USER: `dbu_${suffix}`,
        POSTGRES_DB: DEFAULT_INSTALL_POSTGRES_DB,
        POSTGRES_PASSWORD: random(18).toString("base64url"),
        MINIO_ROOT_USER: `minio_${suffix}`,
        MINIO_ROOT_PASSWORD: random(18).toString("base64url"),
        DIRECTUS_ADMIN_EMAIL: DEFAULT_INSTALL_ADMIN_EMAIL,
        DIRECTUS_ADMIN_PASSWORD: random(24).toString("base64url"),
        STORAGE_S3_KEY: `s3_${suffix}`,
        STORAGE_S3_SECRET: random(24).toString("base64url"),
        AI_SUMMARY_INTERNAL_SECRET: random(24).toString("hex"),
        APP_SECRET_ENCRYPTION_KEY: random(32).toString("base64"),
        DIRECTUS_WEB_STATIC_TOKEN: random(24).toString("hex"),
        DIRECTUS_WORKER_STATIC_TOKEN: random(24).toString("hex"),
        DIRECTUS_WEB_SERVICE_EMAIL: `svc-web-${suffix}@example.com`,
        DIRECTUS_WEB_SERVICE_PASSWORD: random(24).toString("base64url"),
        DIRECTUS_WORKER_SERVICE_EMAIL: `svc-worker-${suffix}@example.com`,
        DIRECTUS_WORKER_SERVICE_PASSWORD: random(24).toString("base64url"),
    };
}

/**
 * @param {{
 *   appPublicBaseUrl: string;
 *   directusUrl: string;
 *   publicAssetBaseUrl?: string;
 *   redisUrl?: string;
 *   directusWebStaticToken?: string;
 *   directusWorkerStaticToken?: string;
 *   directusAdminEmail: string;
 *   directusAdminPassword: string;
 *   directusSecret: string;
 *   postgresUser: string;
 *   postgresDb: string;
 *   postgresPassword: string;
 *   minioRootUser: string;
 *   minioRootPassword: string;
 *   storageS3Key: string;
 *   storageS3Secret: string;
 *   appSecretEncryptionKey: string;
 *   aiSummaryInternalSecret: string;
 * }} params
 * @returns {Record<string, string>}
 */
export function buildEnvValues(params) {
    return {
        APP_PUBLIC_BASE_URL: params.appPublicBaseUrl,
        PUBLIC_ASSET_BASE_URL: params.publicAssetBaseUrl || "",
        DIRECTUS_URL: params.directusUrl,
        DIRECTUS_WEB_STATIC_TOKEN: params.directusWebStaticToken || "",
        DIRECTUS_WORKER_STATIC_TOKEN: params.directusWorkerStaticToken || "",
        DIRECTUS_ADMIN_EMAIL: params.directusAdminEmail,
        DIRECTUS_ADMIN_PASSWORD: params.directusAdminPassword,
        DIRECTUS_SECRET: params.directusSecret,
        POSTGRES_USER: params.postgresUser,
        POSTGRES_DB: params.postgresDb,
        POSTGRES_PASSWORD: params.postgresPassword,
        REDIS_URL: params.redisUrl || "redis://127.0.0.1:6379/0",
        MINIO_ROOT_USER: params.minioRootUser,
        MINIO_ROOT_PASSWORD: params.minioRootPassword,
        STORAGE_S3_KEY: params.storageS3Key,
        STORAGE_S3_SECRET: params.storageS3Secret,
        APP_SECRET_ENCRYPTION_KEY: params.appSecretEncryptionKey,
        AI_SUMMARY_INTERNAL_SECRET: params.aiSummaryInternalSecret,
    };
}

/**
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function renderEnvFile(values) {
    return [
        "# ============================================",
        "# CiaLli installer-generated environment file",
        "# 由 cialli-install 生成；如需重建请重新运行安装器",
        "# ============================================",
        "",
        "# ============================================",
        "# Public Entry",
        "# ============================================",
        `APP_PUBLIC_BASE_URL=${values.APP_PUBLIC_BASE_URL}`,
        "# 可选：公开资源基础地址。留空则统一走站内 BFF 代理（/api/v1/public/assets/:id）",
        `PUBLIC_ASSET_BASE_URL=${values.PUBLIC_ASSET_BASE_URL}`,
        "",
        "# ============================================",
        "# Directus",
        "# web / worker 独立使用 Directus 静态 token，安装器会在服务账号创建后自动回填",
        "# ============================================",
        `DIRECTUS_URL=${values.DIRECTUS_URL}`,
        `DIRECTUS_WEB_STATIC_TOKEN=${values.DIRECTUS_WEB_STATIC_TOKEN}`,
        `DIRECTUS_WORKER_STATIC_TOKEN=${values.DIRECTUS_WORKER_STATIC_TOKEN}`,
        `DIRECTUS_SECRET=${values.DIRECTUS_SECRET}`,
        "",
        "# ============================================",
        "# PostgreSQL / Redis / MinIO",
        "# ============================================",
        `POSTGRES_USER=${values.POSTGRES_USER}`,
        `POSTGRES_DB=${values.POSTGRES_DB}`,
        `POSTGRES_PASSWORD=${values.POSTGRES_PASSWORD}`,
        `REDIS_URL=${values.REDIS_URL}`,
        `MINIO_ROOT_USER=${values.MINIO_ROOT_USER}`,
        `MINIO_ROOT_PASSWORD=${values.MINIO_ROOT_PASSWORD}`,
        "",
        "# ============================================",
        "# Installer Admin Bootstrap",
        "# 仅安装期与运维排障使用；运行时服务本身不依赖以下两项",
        "# ============================================",
        `DIRECTUS_ADMIN_EMAIL=${values.DIRECTUS_ADMIN_EMAIL}`,
        `DIRECTUS_ADMIN_PASSWORD=${values.DIRECTUS_ADMIN_PASSWORD}`,
        "",
        "# ============================================",
        "# Directus Storage Locations",
        "# ============================================",
        `STORAGE_S3_KEY=${values.STORAGE_S3_KEY}`,
        `STORAGE_S3_SECRET=${values.STORAGE_S3_SECRET}`,
        "",
        "# ============================================",
        "# Application Secrets",
        "# ============================================",
        "# 应用密钥加密主密钥（base64 编码的 32-byte key）",
        `APP_SECRET_ENCRYPTION_KEY=${values.APP_SECRET_ENCRYPTION_KEY}`,
        "",
        "# ============================================",
        "# AI Summary Worker",
        "# ============================================",
        `AI_SUMMARY_INTERNAL_SECRET=${values.AI_SUMMARY_INTERNAL_SECRET}`,
        "",
    ].join("\n");
}
