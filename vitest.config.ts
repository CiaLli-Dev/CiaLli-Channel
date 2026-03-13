import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
            "@components": resolve(__dirname, "src/components"),
            "@assets": resolve(__dirname, "src/assets"),
            "@constants": resolve(__dirname, "src/constants"),
            "@utils": resolve(__dirname, "src/utils"),
            "@i18n": resolve(__dirname, "src/i18n"),
            "@layouts": resolve(__dirname, "src/layouts"),
        },
    },
    test: {
        include: ["src/**/__tests__/**/*.test.ts"],
        environment: "node",
        setupFiles: ["src/__tests__/setup.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage",
            include: ["src/server/**"],
            exclude: [
                "**/__tests__/**",
                "**/*.test.ts",
                "**/*.d.ts",
                "**/types.ts",
                "**/index.ts",
            ],
            thresholds: {
                "src/server/domain/**": {
                    statements: 80,
                    branches: 80,
                    functions: 80,
                    lines: 80,
                },
            },
        },
    },
});
