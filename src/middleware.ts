import { defineMiddleware } from "astro:middleware";

import { systemSiteConfig } from "@/config";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { assertRequiredEnv } from "@/server/env/required";
import { readCsrfToken } from "@/server/security/csrf";
import { getResolvedSiteSettings } from "@/server/site-settings/service";

function buildEnvErrorResponse(pathname: string): Response {
    const isApiRequest = pathname.startsWith("/api/");
    const configMissingMessage = i18n(
        I18nKey.interactionApiServerConfigMissing,
    );
    if (isApiRequest) {
        return new Response(
            JSON.stringify({
                ok: false,
                message: configMissingMessage,
                code: "SERVER_ENV_MISSING",
            }),
            {
                status: 500,
                headers: {
                    "content-type": "application/json; charset=utf-8",
                },
            },
        );
    }

    return new Response(configMissingMessage, {
        status: 500,
        headers: {
            "content-type": "text/plain; charset=utf-8",
        },
    });
}

export const onRequest = defineMiddleware(async (context, next) => {
    // 预渲染页面构建时，request.headers 不可用，跳过运行时逻辑
    if (context.isPrerendered) {
        try {
            context.locals.siteSettings = await getResolvedSiteSettings();
            // 同步全局语言，保证服务端渲染文案与站点设置一致
            systemSiteConfig.lang = context.locals.siteSettings.system.lang;
        } catch (error) {
            console.error("[middleware] failed to load site settings:", error);
        }
        return next();
    }

    // 1. 生成/复用请求 ID
    const upstreamId = context.request.headers.get("x-request-id");
    const requestId =
        upstreamId && upstreamId.length <= 128
            ? upstreamId
            : crypto.randomUUID();
    context.locals.requestId = requestId;

    // 2. 环境变量校验
    try {
        assertRequiredEnv();
    } catch (error) {
        console.error("[middleware] required env validation failed:", error);
        return buildEnvErrorResponse(context.url.pathname);
    }

    // 3. 加载站点设置
    try {
        context.locals.siteSettings = await getResolvedSiteSettings();
        // 站点语言是全局配置，按请求同步一次即可避免 i18n 固定为默认语言
        systemSiteConfig.lang = context.locals.siteSettings.system.lang;
    } catch (error) {
        console.error("[middleware] failed to load site settings:", error);
    }

    // 4. 仅透传现有 CSRF token；首次 token 改为客户端按需拉取。
    context.locals.csrfToken = readCsrfToken(context);

    // 5. 执行后续处理
    const response = await next();

    // 6. 响应头附加 requestId
    response.headers.set("X-Request-ID", requestId);
    return response;
});
