export const fontBuildConfig = {
    sourceDirectory: "font-sources",
    outputDirectory: "public/assets/font",
    generatedCssFilename: "generated-fonts.css",
    generatedManifestFilename: "manifest.json",
    generatedRuntimeModule: "src/generated/font-manifest.ts",
    scanDirectories: ["src", "scripts"],
    scanFileExtensions: new Set([
        ".astro",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".svelte",
        ".md",
        ".mdx",
        ".json",
        ".css",
        ".styl",
    ]),
    fontFaces: {
        ascii: {
            family: "ZenMaruGothic-Medium",
            sourceFile: "ZenMaruGothic-Medium.woff2",
            weight: 500,
            style: "normal",
            display: "swap",
            preloadCritical: true,
        },
        cjk: {
            family: "LoliTi-SecondEdition",
            sourceFile: "LoliTi-SecondEdition.woff2",
            weight: 400,
            style: "normal",
            coreDisplay: "swap",
            fallbackDisplay: "swap",
            preloadCritical: true,
            fallbackUnicodeRange:
                "U+2000-206F, U+20A0-20CF, U+2100-214F, U+2E80-2EFF, U+2F00-2FDF, U+2FF0-2FFF, U+3000-303F, U+3040-30FF, U+3100-312F, U+3130-318F, U+3190-31EF, U+31F0-31FF, U+3200-32FF, U+3300-33FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF",
        },
    },
    requiredCharacters: {
        // ASCII 核心额外强制保留字符（按需扩展）
        ascii: "",
        // shared 字符会同时注入 ASCII / CJK 子集，避免标点在多字体间跳变
        shared: "，。！？：；、（）【】《》「」『』“”‘’—…·～￥",
        // 覆盖常见 UI 文本，避免关键导航字符落到全量兜底字体上
        cjk: "首页归档发布我的关于站点统计个人主页收藏日记相册分类标签公告搜索评论回复点赞加载更多上一页下一页返回顶部提交取消确认保存设置主题浅色深色系统登录注册退出欢迎博客文章内容时间日期作者樱理视觉小说同好会没有什么特别的事但有你就足够了到现在你依然是我的光不知不觉你成了我的每一天和你聊几句日子就会变得有点小快乐今天没什么特别但也算是个小好日",
    },
    deferredWarmup: {
        enabled: true,
        trigger: "window-load-idle",
        sessionKey: "cialli.font.deferred-warmup.v1",
        fetchpriority: "low",
    },
};
