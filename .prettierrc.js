export default {
    // 全局默认配置
    printWidth: 80,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: false,
    quoteProps: "as-needed",
    trailingComma: "all",
    bracketSpacing: true,
    arrowParens: "always",
    endOfLine: "crlf",
    plugins: ["prettier-plugin-astro", "prettier-plugin-svelte"],

    overrides: [
        {
            // Astro 组件文件
            files: ["**/*.astro"],
            options: {
                parser: "astro",
                tabWidth: 2,
                useTabs: false,
            },
        },
        {
            // Svelte 组件文件
            files: ["**/*.svelte"],
            options: {
                parser: "svelte",
                tabWidth: 2,
                useTabs: false,
            },
        },
        {
            // CSS 相关文件
            files: ["**/*.css"],
            options: {
                printWidth: 200,
                tabWidth: 2,
                useTabs: false,
            },
        },
        {
            // JSON 配置文件
            files: ["**/*.json", "**/*.jsonc"],
            options: {
                tabWidth: 2,
                useTabs: false,
            },
        },
        {
            // YAML 配置文件
            files: ["**/*.{yml,yaml}"],
            options: {
                tabWidth: 2,
                useTabs: false,
            },
        },
        {
            // Markdown 文档文件
            files: ["**/*.{md,mdx}"],
            options: {
                proseWrap: "preserve",
                tabWidth: 2,
                useTabs: false,
            },
        },
    ],
};
