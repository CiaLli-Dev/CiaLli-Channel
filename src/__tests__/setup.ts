/**
 * 全局测试环境 setup
 *
 * 设置测试环境变量，确保不会发起真实网络请求。
 */

// 设置测试环境变量
process.env.DIRECTUS_URL = "http://localhost:8055";
process.env.DIRECTUS_STATIC_TOKEN = "test-static-token";
process.env.BANGUMI_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
);
