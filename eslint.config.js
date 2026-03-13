import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import astro from "eslint-plugin-astro";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

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
        files: ["**/*.svelte"],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
                extraFileExtensions: [".svelte"],
                svelteConfig: "./svelte.config.js",
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
            "@typescript-eslint/consistent-type-imports": [
                "warn",
                { prefer: "type-imports", disallowTypeAnnotations: false },
            ],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/ban-ts-comment": "warn",
            "@typescript-eslint/triple-slash-reference": "warn",
        },
    },
    prettier,
);
