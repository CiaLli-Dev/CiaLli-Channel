import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const projectRootDir = __dirname;

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(projectRootDir, "src"),
            "@components": resolve(projectRootDir, "src/components"),
            "@assets": resolve(projectRootDir, "src/assets"),
            "@constants": resolve(projectRootDir, "src/constants"),
            "@utils": resolve(projectRootDir, "src/utils"),
            "@i18n": resolve(projectRootDir, "src/i18n"),
            "@layouts": resolve(projectRootDir, "src/layouts"),
        },
    },
    test: {
        include: ["src/**/__tests__/**/*.test.ts"],
        environment: "node",
        setupFiles: [resolve(projectRootDir, "src/__tests__/setup.ts")],
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
