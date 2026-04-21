#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";

loadDotenv();

const REQUIRED_KEYS = [
    "APP_PUBLIC_BASE_URL",
    "APP_PUBLIC_HOSTNAME",
    "DIRECTUS_URL",
    "DIRECTUS_INTERNAL_URL",
    "DIRECTUS_PUBLIC_URL",
    "DIRECTUS_STATIC_TOKEN",
    "DIRECTUS_SECRET",
    "DIRECTUS_KEY",
    "DIRECTUS_ADMIN_EMAIL",
    "DIRECTUS_ADMIN_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "REDIS_URL",
    "REDIS_INTERNAL_URL",
    "DIRECTUS_REDIS_URL",
    "REDIS_NAMESPACE",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_BUCKET",
    "STORAGE_LOCATIONS",
    "STORAGE_S3_DRIVER",
    "STORAGE_S3_KEY",
    "STORAGE_S3_SECRET",
    "STORAGE_S3_BUCKET",
    "STORAGE_S3_REGION",
    "STORAGE_S3_ENDPOINT",
    "STORAGE_S3_FORCE_PATH_STYLE",
    "BANGUMI_TOKEN_ENCRYPTION_KEY",
    "AI_SUMMARY_INTERNAL_SECRET",
    "AI_SUMMARY_WORKER_PORT",
];

const PRODUCTION_SENSITIVE_KEYS = [
    "DIRECTUS_STATIC_TOKEN",
    "DIRECTUS_SECRET",
    "DIRECTUS_KEY",
    "DIRECTUS_ADMIN_PASSWORD",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_PASSWORD",
    "STORAGE_S3_SECRET",
    "BANGUMI_TOKEN_ENCRYPTION_KEY",
    "AI_SUMMARY_INTERNAL_SECRET",
];

const DANGEROUS_DEFAULTS = new Set([
    "",
    "change-me",
    "change-me-too",
    "directus",
    "minioadmin",
    "admin@example.com",
    "admin@123456",
    "local-ai-summary-secret",
]);

function readEnv(name) {
    return String(process.env[name] || "").trim();
}

function isLocalHostname(hostname) {
    const normalized = String(hostname || "")
        .trim()
        .toLowerCase();
    return (
        normalized === "localhost" ||
        normalized === "127.0.0.1" ||
        normalized.endsWith(".local")
    );
}

function isLocalBaseUrl(urlValue) {
    try {
        return isLocalHostname(new URL(urlValue).hostname);
    } catch {
        return false;
    }
}

const missing = REQUIRED_KEYS.filter((key) => !readEnv(key));

const strictMode =
    process.env.CHECK_ENV_STRICT === "1" ||
    (!isLocalHostname(readEnv("APP_PUBLIC_HOSTNAME")) &&
        !isLocalBaseUrl(readEnv("APP_PUBLIC_BASE_URL")));

const unsafe = strictMode
    ? PRODUCTION_SENSITIVE_KEYS.filter((key) =>
          DANGEROUS_DEFAULTS.has(readEnv(key)),
      )
    : [];

if (!strictMode) {
    console.info(
        "[check:env] 检测到本地/开发入口，已跳过生产敏感默认值校验；如需强制执行可设置 CHECK_ENV_STRICT=1。",
    );
}

if (missing.length > 0) {
    console.error(
        `[check:env] 缺少必填环境变量: ${missing.map((key) => `\`${key}\``).join(", ")}`,
    );
}

if (unsafe.length > 0) {
    console.error(
        `[check:env] 生产模式下存在危险默认值，请替换: ${unsafe.map((key) => `\`${key}\``).join(", ")}`,
    );
}

if (missing.length > 0 || unsafe.length > 0) {
    process.exit(1);
}

console.info("[check:env] 环境变量校验通过。");
