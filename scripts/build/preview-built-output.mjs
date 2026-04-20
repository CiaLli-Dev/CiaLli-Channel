#!/usr/bin/env node

import vercelImageService from "@astrojs/vercel/build-image-service";
import sharpImageService from "astro/assets/services/sharp";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4321;
const WORKSPACE_ROOT = process.cwd();
const VERCEL_OUTPUT_DIR = path.join(WORKSPACE_ROOT, ".vercel", "output");
const STATIC_ROOT = path.join(VERCEL_OUTPUT_DIR, "static");
const OUTPUT_CONFIG_PATH = path.join(VERCEL_OUTPUT_DIR, "config.json");
const RENDER_FUNCTION_DIR = path.join(
    VERCEL_OUTPUT_DIR,
    "functions",
    "_render.func",
);
const RENDER_FUNCTION_CONFIG_PATH = path.join(
    RENDER_FUNCTION_DIR,
    ".vc-config.json",
);
const PREVIEW_IMAGE_SERVICE_CONFIG = Object.freeze({
    limitInputPixels: true,
    kernel: "lanczos3",
});

const MIME_TYPES = new Map([
    [".avif", "image/avif"],
    [".css", "text/css; charset=utf-8"],
    [".gif", "image/gif"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".txt", "text/plain; charset=utf-8"],
    [".ttf", "font/ttf"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
    [".xml", "application/xml; charset=utf-8"],
]);

function exitWithUsage(message) {
    if (message) {
        console.error(`[preview] ${message}`);
    }
    console.error(
        "[preview] 用法：pnpm preview -- [--host <host>] [--port <port>]",
    );
    process.exit(1);
}

function parsePort(value) {
    if (!/^\d+$/.test(value)) {
        exitWithUsage(`无效端口：${value}`);
    }

    const port = Number.parseInt(value, 10);
    if (port < 1 || port > 65535) {
        exitWithUsage(`端口超出范围：${value}`);
    }
    return port;
}

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === "--") {
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            console.log(
                "pnpm preview -- [--host <host>] [--port <port>]\n\n该命令仅预览现有的 Vercel 构建产物；若尚未构建，请先执行 pnpm build。",
            );
            process.exit(0);
        }

        if (argument === "--host") {
            const value = argv[index + 1];
            if (!value) {
                exitWithUsage("--host 缺少参数");
            }
            options.host = value;
            index += 1;
            continue;
        }

        if (argument === "--port") {
            const value = argv[index + 1];
            if (!value) {
                exitWithUsage("--port 缺少参数");
            }
            options.port = parsePort(value);
            index += 1;
            continue;
        }

        exitWithUsage(`不支持的参数：${argument}`);
    }

    return options;
}

function ensureBuildOutputExists() {
    const requiredPaths = [
        OUTPUT_CONFIG_PATH,
        STATIC_ROOT,
        RENDER_FUNCTION_CONFIG_PATH,
    ];

    const missingPaths = requiredPaths.filter(
        (filePath) => !existsSync(filePath),
    );
    if (missingPaths.length > 0) {
        console.error(
            "[preview] 未找到可预览的构建产物，请先执行 `pnpm build`。",
        );
        for (const filePath of missingPaths) {
            console.error(
                `[preview] 缺失：${path.relative(WORKSPACE_ROOT, filePath)}`,
            );
        }
        process.exit(1);
    }
}

async function loadRenderEntrypointPath() {
    let functionConfig;
    try {
        const raw = await fs.readFile(RENDER_FUNCTION_CONFIG_PATH, "utf8");
        functionConfig = JSON.parse(raw);
    } catch (error) {
        console.error(
            `[preview] 读取 ${path.relative(WORKSPACE_ROOT, RENDER_FUNCTION_CONFIG_PATH)} 失败：`,
            error,
        );
        process.exit(1);
    }

    const handler = functionConfig?.handler;
    if (typeof handler !== "string" || handler.length === 0) {
        console.error(
            "[preview] _render 函数缺少 handler 配置，无法启动预览。",
        );
        process.exit(1);
    }

    const entrypointPath = path.resolve(RENDER_FUNCTION_DIR, handler);
    if (!existsSync(entrypointPath)) {
        console.error(
            `[preview] 构建产物中的 SSR 入口不存在：${path.relative(WORKSPACE_ROOT, entrypointPath)}`,
        );
        console.error("[preview] 请重新执行 `pnpm build` 后再试。");
        process.exit(1);
    }

    return entrypointPath;
}

async function loadRenderHandler(entrypointPath) {
    let renderModule;
    try {
        renderModule = await import(pathToFileURL(entrypointPath).href);
    } catch (error) {
        console.error("[preview] 加载构建产物中的 SSR 入口失败：", error);
        process.exit(1);
    }

    if (typeof renderModule.default?.fetch !== "function") {
        console.error(
            "[preview] 构建产物中的 SSR 入口不符合预期，缺少 fetch()。",
        );
        process.exit(1);
    }

    return renderModule.default.fetch.bind(renderModule.default);
}

async function loadOutputConfig() {
    try {
        const raw = await fs.readFile(OUTPUT_CONFIG_PATH, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        console.error(
            `[preview] 读取 ${path.relative(WORKSPACE_ROOT, OUTPUT_CONFIG_PATH)} 失败：`,
            error,
        );
        process.exit(1);
    }
}

async function loadStaticHeaderRules() {
    const headersPath = path.join(STATIC_ROOT, "_headers");
    if (!existsSync(headersPath)) {
        return [];
    }

    const rules = [];
    const content = await fs.readFile(headersPath, "utf8");
    const lines = content.split(/\r?\n/u);
    let currentRule = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.length === 0 || trimmed.startsWith("#")) {
            continue;
        }

        if (line.startsWith(" ") || line.startsWith("\t")) {
            if (!currentRule) {
                continue;
            }

            const separatorIndex = trimmed.indexOf(":");
            if (separatorIndex <= 0) {
                continue;
            }

            const headerName = trimmed
                .slice(0, separatorIndex)
                .trim()
                .toLowerCase();
            const headerValue = trimmed.slice(separatorIndex + 1).trim();
            currentRule.headers.set(headerName, headerValue);
            continue;
        }

        currentRule = {
            pattern: trimmed,
            headers: new Map(),
        };
        rules.push(currentRule);
    }

    return rules;
}

function matchesStaticHeaderRule(pattern, pathname) {
    if (pattern.endsWith("*")) {
        return pathname.startsWith(pattern.slice(0, -1));
    }
    return pathname === pattern;
}

function collectStaticHeaders(pathname, headerRules) {
    const headers = new Map();

    if (
        pathname.startsWith("/_astro/") ||
        pathname.startsWith("/assets/font/")
    ) {
        headers.set("cache-control", "public, max-age=31536000, immutable");
    }

    for (const rule of headerRules) {
        if (!matchesStaticHeaderRule(rule.pattern, pathname)) {
            continue;
        }
        for (const [headerName, headerValue] of rule.headers) {
            headers.set(headerName, headerValue);
        }
    }

    return headers;
}

function getSafeStaticPath(pathname) {
    let decodedPathname;
    try {
        decodedPathname = decodeURIComponent(pathname);
    } catch {
        return null;
    }

    const staticRoot = path.resolve(STATIC_ROOT);
    const resolvedPath = path.resolve(staticRoot, `.${decodedPathname}`);
    const isRoot = resolvedPath === staticRoot;
    const isChild = resolvedPath.startsWith(`${staticRoot}${path.sep}`);

    if (!isRoot && !isChild) {
        return null;
    }

    return resolvedPath;
}

async function resolveStaticAssetFile(pathname) {
    const safePath = getSafeStaticPath(pathname);
    if (!safePath) {
        return { errorStatus: 403 };
    }

    try {
        const stats = await fs.stat(safePath);
        if (!stats.isFile()) {
            return { errorStatus: 404 };
        }

        return { filePath: safePath, stats };
    } catch {
        return { errorStatus: 404 };
    }
}

async function resolveStaticFile(pathname) {
    const safePath = getSafeStaticPath(pathname);
    if (!safePath) {
        return { errorStatus: 400 };
    }

    const candidates = [safePath];
    if (path.extname(pathname) === "") {
        candidates.push(path.join(safePath, "index.html"));
    }

    for (const candidate of candidates) {
        try {
            const stats = await fs.stat(candidate);
            if (stats.isFile()) {
                return { filePath: candidate, stats };
            }
        } catch {
            continue;
        }
    }

    return { filePath: null };
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return MIME_TYPES.get(extension) ?? "application/octet-stream";
}

function getContentTypeFromImageFormat(format) {
    return MIME_TYPES.get(`.${String(format || "").toLowerCase()}`);
}

function createRedirectLocation(url) {
    const { pathname, search } = url;
    if (pathname === "/" || !pathname.endsWith("/")) {
        return null;
    }

    const strippedPathname = pathname.replace(/\/+$/u, "") || "/";
    return `${strippedPathname}${search}`;
}

function sendPlainText(res, statusCode, message) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(message);
}

function writeBinaryResponse(
    res,
    statusCode,
    contentType,
    body,
    extraHeaders = {},
) {
    res.statusCode = statusCode;
    res.setHeader("content-type", contentType);
    res.setHeader("content-length", String(body.byteLength));

    for (const [headerName, headerValue] of Object.entries(extraHeaders)) {
        res.setHeader(headerName, headerValue);
    }
}

function appendRequestHeaders(headers, requestHeaders) {
    for (const [headerName, headerValue] of Object.entries(requestHeaders)) {
        if (typeof headerValue === "undefined") {
            continue;
        }

        if (Array.isArray(headerValue)) {
            for (const item of headerValue) {
                headers.append(headerName, item);
            }
            continue;
        }

        headers.append(headerName, headerValue);
    }
}

function createForwardRequest(req, requestUrl) {
    const headers = new globalThis.Headers();
    appendRequestHeaders(headers, req.headers);

    const method = req.method ?? "GET";
    const shouldSendBody = method !== "GET" && method !== "HEAD";

    return new globalThis.Request(requestUrl.toString(), {
        method,
        headers,
        body: shouldSendBody ? req : undefined,
        duplex: shouldSendBody ? "half" : undefined,
    });
}

function rewritePreviewSetCookie(setCookieValue, requestUrl) {
    if (requestUrl.protocol === "https:") {
        return setCookieValue;
    }

    return setCookieValue.replace(/;\s*Secure\b/giu, "");
}

function writeResponseHeaders(res, responseHeaders, requestUrl) {
    const setCookieValues =
        typeof responseHeaders.getSetCookie === "function"
            ? responseHeaders
                  .getSetCookie()
                  .map((value) => rewritePreviewSetCookie(value, requestUrl))
            : [];

    for (const [headerName, headerValue] of responseHeaders.entries()) {
        if (headerName === "set-cookie") {
            continue;
        }
        res.setHeader(headerName, headerValue);
    }

    if (setCookieValues.length > 0) {
        // Node 原生响应需要数组形式才能正确发出多条 Set-Cookie。
        res.setHeader("set-cookie", setCookieValues);
    }
}

function streamFetchResponse(req, res, response, requestUrl) {
    res.statusCode = response.status;
    writeResponseHeaders(res, response.headers, requestUrl);

    if (req.method === "HEAD" || !response.body) {
        res.end();
        return;
    }

    Readable.fromWeb(response.body).pipe(res);
}

function serveStaticFile(req, res, pathname, filePath, stats, headerRules) {
    const headers = collectStaticHeaders(pathname, headerRules);

    res.statusCode = 200;
    res.setHeader("content-type", getContentType(filePath));
    res.setHeader("content-length", String(stats.size));

    for (const [headerName, headerValue] of headers) {
        res.setHeader(headerName, headerValue);
    }

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    createReadStream(filePath).pipe(res);
}

function parsePositiveIntegerParam(rawValue) {
    if (rawValue === null) {
        return { value: undefined };
    }

    if (!/^\d+$/u.test(rawValue)) {
        return { errorStatus: 400 };
    }

    const value = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        return { errorStatus: 400 };
    }

    return { value };
}

function parseImageQualityParam(rawValue) {
    if (rawValue === null) {
        return { value: undefined };
    }

    const value = rawValue.trim().toLowerCase();
    if (value.length === 0) {
        return { value: undefined };
    }

    if (/^(low|mid|high|max)$/u.test(value) || /^\d+$/u.test(value)) {
        return { value };
    }

    return { errorStatus: 400 };
}

function parseImageFormatParam(rawValue) {
    if (rawValue === null) {
        return { value: undefined };
    }

    const value = rawValue.trim().toLowerCase();
    if (value.length === 0) {
        return { value: undefined };
    }

    if (/^[a-z0-9]+$/u.test(value)) {
        return { value };
    }

    return { errorStatus: 400 };
}

function parseOptionalTextParam(rawValue) {
    if (rawValue === null) {
        return undefined;
    }

    const value = rawValue.trim();
    return value.length > 0 ? value : undefined;
}

function normalizePreviewImageSourcePath(rawSource, requestUrl) {
    const value = String(rawSource || "").trim();
    if (!value) {
        return { errorStatus: 400 };
    }

    if (value.startsWith("//")) {
        return { errorStatus: 403 };
    }

    const isAbsoluteUrl = /^[a-z][a-z\d+\-.]*:/iu.test(value);
    if (isAbsoluteUrl) {
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            return { errorStatus: 400 };
        }

        if (parsed.origin !== requestUrl.origin) {
            return { errorStatus: 403 };
        }

        return {
            pathname: parsed.pathname,
        };
    }

    const normalizedPath = value
        .replace(/\\/gu, "/")
        .replace(/^\.\/+/u, "")
        .replace(/^\/+/u, "/");

    return {
        pathname: normalizedPath.startsWith("/")
            ? normalizedPath
            : `/${normalizedPath}`,
    };
}

function createPreviewImageServiceOptions(outputConfig) {
    const configuredSizes = Array.isArray(outputConfig?.images?.sizes)
        ? outputConfig.images.sizes.filter(
              (value) => Number.isInteger(value) && value > 0,
          )
        : [];

    return {
        service: {
            config: {
                sizes: configuredSizes,
            },
        },
    };
}

function normalizePreviewImageTransform(transform, previewImageOptions) {
    if (
        typeof transform.width !== "number" ||
        previewImageOptions.service.config.sizes.length === 0
    ) {
        return transform;
    }

    return vercelImageService.validateOptions(
        { ...transform },
        previewImageOptions,
    );
}

function parsePreviewImageRequest(requestUrl) {
    const searchParams = requestUrl.searchParams;
    const sourcePathResult = normalizePreviewImageSourcePath(
        searchParams.get("url") ?? searchParams.get("href"),
        requestUrl,
    );
    if (typeof sourcePathResult.errorStatus === "number") {
        return sourcePathResult;
    }

    const widthResult = parsePositiveIntegerParam(searchParams.get("w"));
    if (typeof widthResult.errorStatus === "number") {
        return widthResult;
    }

    const heightResult = parsePositiveIntegerParam(searchParams.get("h"));
    if (typeof heightResult.errorStatus === "number") {
        return heightResult;
    }

    const qualityResult = parseImageQualityParam(searchParams.get("q"));
    if (typeof qualityResult.errorStatus === "number") {
        return qualityResult;
    }

    const formatResult = parseImageFormatParam(searchParams.get("f"));
    if (typeof formatResult.errorStatus === "number") {
        return formatResult;
    }

    return {
        sourcePathname: sourcePathResult.pathname,
        transform: {
            src: sourcePathResult.pathname,
            width: widthResult.value,
            height: heightResult.value,
            quality: qualityResult.value,
            format: formatResult.value,
            fit: parseOptionalTextParam(searchParams.get("fit")),
            position: parseOptionalTextParam(searchParams.get("position")),
            background: parseOptionalTextParam(searchParams.get("background")),
        },
    };
}

async function servePreviewImage(req, res, requestUrl, previewImageOptions) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.setHeader("allow", "GET, HEAD");
        res.end();
        return;
    }

    const imageRequest = parsePreviewImageRequest(requestUrl);
    if (typeof imageRequest.errorStatus === "number") {
        const message =
            imageRequest.errorStatus === 403 ? "Forbidden" : "Bad Request";
        sendPlainText(res, imageRequest.errorStatus, message);
        return;
    }

    const sourceFile = await resolveStaticAssetFile(
        imageRequest.sourcePathname,
    );
    if (typeof sourceFile.errorStatus === "number") {
        const message =
            sourceFile.errorStatus === 403 ? "Forbidden" : "Not Found";
        sendPlainText(res, sourceFile.errorStatus, message);
        return;
    }

    const sourceBuffer = await fs.readFile(sourceFile.filePath);
    const normalizedTransform = normalizePreviewImageTransform(
        imageRequest.transform,
        previewImageOptions,
    );

    // Vercel 产物里的 `/_vercel/image` 实际依赖平台级图片代理，本地预览没有该平台层，
    // 因此这里直接使用 Astro 的本地 Sharp 服务读取 `.vercel/output/static` 里的源文件并生成结果。
    const transformedImage = await sharpImageService.transform(
        sourceBuffer,
        normalizedTransform,
        {
            service: {
                config: PREVIEW_IMAGE_SERVICE_CONFIG,
            },
        },
    );

    const contentType =
        getContentTypeFromImageFormat(transformedImage.format) ??
        getContentType(sourceFile.filePath);

    writeBinaryResponse(res, 200, contentType, transformedImage.data, {
        "cache-control": "public, max-age=31536000",
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    res.end(transformedImage.data);
}

function createPreviewUrl(host, port) {
    const resolvedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    return `http://${resolvedHost}:${port}/`;
}

function createRequestUrl(req, fallbackHost) {
    const origin = `http://${req.headers.host ?? fallbackHost}`;
    return new URL(req.url ?? "/", origin);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    ensureBuildOutputExists();

    const outputConfig = await loadOutputConfig();
    const renderEntrypointPath = await loadRenderEntrypointPath();
    const renderHandler = await loadRenderHandler(renderEntrypointPath);
    const staticHeaderRules = await loadStaticHeaderRules();
    const previewImageOptions = createPreviewImageServiceOptions(outputConfig);

    const server = http.createServer(async (req, res) => {
        try {
            const requestUrl = createRequestUrl(
                req,
                `${options.host}:${options.port}`,
            );
            const redirectLocation = createRedirectLocation(requestUrl);
            if (redirectLocation) {
                res.statusCode = 308;
                res.setHeader("location", redirectLocation);
                res.end();
                return;
            }

            if (requestUrl.pathname === "/_vercel/image") {
                await servePreviewImage(
                    req,
                    res,
                    requestUrl,
                    previewImageOptions,
                );
                return;
            }

            const staticFile = await resolveStaticFile(requestUrl.pathname);
            if (typeof staticFile.errorStatus === "number") {
                sendPlainText(res, staticFile.errorStatus, "Bad Request");
                return;
            }

            if (staticFile.filePath && staticFile.stats) {
                serveStaticFile(
                    req,
                    res,
                    requestUrl.pathname,
                    staticFile.filePath,
                    staticFile.stats,
                    staticHeaderRules,
                );
                return;
            }

            // 不再尝试复用 astro preview；所有未命中的请求统一交给
            // 真实的 Vercel `_render` 入口，保证 SSR 页面和 BFF/API 都基于构建产物运行。
            const request = createForwardRequest(req, requestUrl);
            const response = await renderHandler(request);
            streamFetchResponse(req, res, response, requestUrl);
        } catch (error) {
            console.error("[preview] 请求处理失败：", error);
            sendPlainText(res, 500, "Internal Server Error");
        }
    });

    server.on("error", (error) => {
        console.error("[preview] 本地预览服务启动失败：", error);
        process.exit(1);
    });

    await new Promise((resolve) => {
        server.listen(options.port, options.host, resolve);
    });

    const previewUrl = createPreviewUrl(options.host, options.port);
    console.log(
        `[preview] 正在预览 ${path.relative(WORKSPACE_ROOT, VERCEL_OUTPUT_DIR)}`,
    );
    console.log(`[preview] Local: ${previewUrl}`);

    const shutdown = () => {
        server.close(() => {
            process.exit(0);
        });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

await main();
