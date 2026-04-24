#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";

import { resolvePublicBaseUrl } from "../../src/config/public-base-url.mjs";

loadDotenv();

const REQUIRED_KEYS = [
    "APP_PUBLIC_BASE_URL",
    "DIRECTUS_URL",
    "DIRECTUS_STATIC_TOKEN",
    "DIRECTUS_SECRET",
    "POSTGRES_USER",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "REDIS_URL",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "STORAGE_S3_KEY",
    "STORAGE_S3_SECRET",
    "BANGUMI_TOKEN_ENCRYPTION_KEY",
    "AI_SUMMARY_INTERNAL_SECRET",
];

const PRODUCTION_SENSITIVE_KEYS = [
    "DIRECTUS_STATIC_TOKEN",
    "DIRECTUS_SECRET",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_PASSWORD",
    "STORAGE_S3_SECRET",
    "BANGUMI_TOKEN_ENCRYPTION_KEY",
    "AI_SUMMARY_INTERNAL_SECRET",
];

const DANGEROUS_DEFAULTS = new Set([
    "",
    "change-me",
    "directus",
    "minioadmin",
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
let publicBaseUrlError = null;

if (!missing.includes("APP_PUBLIC_BASE_URL")) {
    try {
        resolvePublicBaseUrl({
            APP_PUBLIC_BASE_URL: readEnv("APP_PUBLIC_BASE_URL"),
        });
    } catch (error) {
        publicBaseUrlError =
            error instanceof Error ? error.message : String(error);
    }
}

const strictMode =
    process.env.CHECK_ENV_STRICT === "1" ||
    !isLocalBaseUrl(readEnv("APP_PUBLIC_BASE_URL"));

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

if (publicBaseUrlError) {
    console.error(
        `[check:env] APP_PUBLIC_BASE_URL 非法: ${publicBaseUrlError}`,
    );
}

if (unsafe.length > 0) {
    console.error(
        `[check:env] 生产模式下存在危险默认值，请替换: ${unsafe.map((key) => `\`${key}\``).join(", ")}`,
    );
}

if (missing.length > 0 || unsafe.length > 0 || publicBaseUrlError) {
    process.exit(1);
}

console.info("[check:env] 环境变量校验通过。");
