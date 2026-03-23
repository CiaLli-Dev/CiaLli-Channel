import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import astro from "eslint-plugin-astro";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));
const projectServiceParserOptions = {
    // typescript-eslint v8 官方推荐在 Flat Config 下使用 projectService 提供 typed lint。
    projectService: true,
    tsconfigRootDir,
};
const astroParserOptions = {
    parser: tseslint.parser,
    project: "./tsconfig.json",
    extraFileExtensions: [".astro"],
    tsconfigRootDir,
};
const svelteParserOptions = {
    parser: tseslint.parser,
    project: "./tsconfig.json",
    extraFileExtensions: [".svelte"],
    svelteConfig: "./svelte.config.js",
    tsconfigRootDir,
};

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            ".vercel/**",
            "node_modules/**",
            "src/layouts/Layout.astro",
        ],
    },
    {
        files: ["**/*.{js,cjs,mjs,ts,tsx,cts,mts,astro,svelte}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2022,
            },
        },
    },
    {
        files: ["**/*.{ts,tsx,cts,mts}"],
        languageOptions: {
            parserOptions: projectServiceParserOptions,
        },
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...astro.configs["flat/recommended"],
    ...svelte.configs["flat/recommended"],
    {
        files: ["**/*.{astro,svelte}"],
        rules: {
            "no-undef": "off",
        },
    },
    {
        files: ["**/*.astro"],
        processor: "astro/client-side-ts",
        languageOptions: {
            parserOptions: {
                ...astroParserOptions,
            },
        },
    },
    {
        files: ["**/*.svelte"],
        languageOptions: {
            parserOptions: {
                ...svelteParserOptions,
            },
        },
    },
    ...svelte.configs["flat/prettier"],
    {
        rules: {
            curly: ["error", "all"],
            eqeqeq: ["warn", "always"],
            "no-implicit-coercion": "error",
            "prefer-const": "error",
            "max-lines": [
                "warn",
                { max: 500, skipBlankLines: true, skipComments: true },
            ],
            "max-lines-per-function": [
                "warn",
                { max: 200, skipBlankLines: true, skipComments: true },
            ],
            complexity: ["warn", { max: 15 }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/ban-ts-comment": "warn",
            "@typescript-eslint/triple-slash-reference": "warn",
        },
    },
    {
        files: ["**/*.{ts,tsx,cts,mts}"],
        ignores: ["**/*.astro/*.ts", "*.astro/*.ts"],
        rules: {
            "@typescript-eslint/consistent-type-imports": [
                "warn",
                { prefer: "type-imports", disallowTypeAnnotations: false },
            ],
        },
    },
    {
        files: ["**/*.astro", "**/*.svelte"],
        rules: {
            "@typescript-eslint/consistent-type-imports": [
                "warn",
                { prefer: "type-imports", disallowTypeAnnotations: false },
            ],
        },
    },
    {
        files: [
            "**/*.astro/*.js",
            "*.astro/*.js",
            "**/*.astro/*.ts",
            "*.astro/*.ts",
        ],
        rules: {
            // define:vars 等 Astro 注入变量会映射到虚拟客户端脚本，
            // 在这层关闭 no-undef，避免把模板注入值误报成未定义。
            "no-undef": "off",
        },
    },
    prettier,
);
