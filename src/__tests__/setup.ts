/**
 * 全局测试环境 setup
 *
 * 设置测试环境变量，确保不会发起真实网络请求。
 */

// 设置测试环境变量
process.env.APP_PUBLIC_BASE_URL = "https://example.com";
process.env.DIRECTUS_URL = "http://localhost:8055";
process.env.DIRECTUS_WEB_STATIC_TOKEN = "test-web-static-token";
process.env.DIRECTUS_WORKER_STATIC_TOKEN = "test-worker-static-token";
process.env.APP_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
