import type { MiddlewareHandler } from "astro";
import { defineMiddleware } from "astro:middleware";

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { assertRequiredEnv } from "@/server/env/required";
import { registerRequestScopedI18n } from "@/server/request-context/i18n";
import { runWithRequestContext } from "@/server/request-context";
import { ensureCsrfCookie } from "@/server/security/csrf";
import { getResolvedSiteSettings } from "@/server/site-settings/service";

registerRequestScopedI18n();

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

export const onRequest: MiddlewareHandler = defineMiddleware(
    async (context, next) => {
        // 预渲染页面构建时，request.headers 不可用，跳过运行时逻辑
        if (context.isPrerendered) {
            let siteSettings = context.locals.siteSettings;
            try {
                siteSettings = await getResolvedSiteSettings();
                context.locals.siteSettings = siteSettings;
            } catch (error) {
                console.error(
                    "[middleware] failed to load site settings:",
                    error,
                );
            }

            return await runWithRequestContext(
                {
                    requestId: "prerender",
                    language: siteSettings?.system.lang ?? "en",
                    siteSettings,
                    isPrerendered: true,
                },
                async () => await next(),
            );
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
            console.error(
                "[middleware] required env validation failed:",
                error,
            );
            return buildEnvErrorResponse(context.url.pathname);
        }

        // 3. 加载站点设置
        let siteSettings = context.locals.siteSettings;
        try {
            siteSettings = await getResolvedSiteSettings();
            context.locals.siteSettings = siteSettings;
        } catch (error) {
            console.error("[middleware] failed to load site settings:", error);
        }

        // 4. 确保 CSRF cookie 存在，服务端注入到 <meta> 供客户端使用
        context.locals.csrfToken = ensureCsrfCookie(context);

        // 5. 执行后续处理
        const response = await runWithRequestContext(
            {
                requestId,
                language: siteSettings?.system.lang ?? "en",
                siteSettings,
            },
            async () => await next(),
        );

        // 6. 响应头附加 requestId
        response.headers.set("X-Request-ID", requestId);
        return response;
    },
);
