import sitemap from "@astrojs/sitemap";
import svelte, { vitePreprocess } from "@astrojs/svelte";
import vercel from "@astrojs/vercel";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { systemSiteConfig } from "./src/config.ts";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import {
    rehypePlugins,
    remarkPlugins,
} from "./src/server/markdown/pipeline.ts";

const _siteHostname = new URL(systemSiteConfig.siteURL).hostname;

// https://astro.build/config
export default defineConfig({
    site: systemSiteConfig.siteURL,
    base: "/",
    trailingSlash: "never",

    security: {
        allowedDomains: [{ hostname: _siteHostname }],
    },

    output: "static",
    adapter: vercel({
        // 启用 Vercel Image Optimization
        imageService: true,
        imagesConfig: {
            sizes: [
                48, 72, 96, 128, 160, 192, 256, 320, 400, 480, 640, 720, 800,
                960, 1200, 1536, 1920, 2560,
            ],
            formats: ["image/avif", "image/webp"],
            minimumCacheTTL: 60 * 60 * 24 * 30,
        },
    }),

    integrations: [
        swup({
            theme: false,
            animationClass: "transition-swup-",
            containers: ["main", "#right-sidebar-slot", "#sidebar"],
            smoothScrolling: false, // 禁用平滑滚动以提升性能，避免与锚点导航冲突
            cache: false, // 关闭 Swup 页面快照缓存，避免旧页面 DOM 在客户端被回放。
            preload: true, // swup 默认鼠标悬停预加载
            accessibility: true,
            updateHead: true,
            updateBodyClass: false,
            globalInstance: true,
            loadOnIdle: false, // 尽早初始化 swup，避免首页快速点击时退回原生跳转
        }),
        icon(),
        expressiveCode({
            themes: ["github-light", "github-dark"],
            plugins: [
                pluginCollapsibleSections(),
                pluginLineNumbers(),
                pluginLanguageBadge(),
                pluginCustomCopyButton(),
            ],
            defaultProps: {
                wrap: true,
                overridesByLang: {
                    shellsession: { showLineNumbers: false },
                    bash: { frame: "code" },
                    shell: { frame: "code" },
                    sh: { frame: "code" },
                    zsh: { frame: "code" },
                },
            },
            styleOverrides: {
                codeBackground: "var(--codeblock-bg)",
                borderRadius: "0.75rem",
                borderColor: "none",
                codeFontSize: "0.875rem",
                codeFontFamily:
                    "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                codeLineHeight: "1.5rem",
                frames: {
                    editorBackground: "var(--codeblock-bg)",
                    terminalBackground: "var(--codeblock-bg)",
                    terminalTitlebarBackground: "var(--codeblock-bg)",
                    editorTabBarBackground: "var(--codeblock-bg)",
                    editorActiveTabBackground: "none",
                    editorActiveTabIndicatorBottomColor: "var(--primary)",
                    editorActiveTabIndicatorTopColor: "none",
                    editorTabBarBorderBottomColor: "var(--codeblock-bg)",
                    terminalTitlebarBorderBottomColor: "none",
                },
                textMarkers: {
                    delHue: 0,
                    insHue: 180,
                    markHue: 250,
                },
            },
            frames: {
                showCopyToClipboardButton: false,
            },
        }),
        svelte({
            preprocess: vitePreprocess(),
        }),
        sitemap(),
    ],
    markdown: {
        remarkPlugins,
        rehypePlugins,
    },
    vite: {
        plugins: [tailwindcss()],
        build: {
            // 静态资源处理优化，防止小图片转 base64 导致 HTML 体积过大（可选，根据需要调整）
            assetsInlineLimit: 4096,

            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (
                            id.includes(
                                "astro/dist/core/middleware/index.js",
                            ) ||
                            id.includes(
                                "astro/dist/core/middleware/sequence.js",
                            )
                        ) {
                            return "astro-middleware-core";
                        }

                        return undefined;
                    },
                },
                onwarn(warning, warn) {
                    if (
                        warning.message.includes(
                            "is dynamically imported by",
                        ) &&
                        warning.message.includes(
                            "but also statically imported by",
                        )
                    ) {
                        return;
                    }
                    warn(warning);
                },
            },
        },
    },
});
