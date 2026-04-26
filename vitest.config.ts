import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const projectRootDir = __dirname;
const sharedSetupFile = resolve(projectRootDir, "src/__tests__/setup.ts");
const clientSetupFile = resolve(
    projectRootDir,
    "src/__tests__/setup.client.ts",
);

const schemaTests = ["src/server/api/schemas/**/__tests__/**/*.test.ts"];
const apiTests = ["src/server/api/**/__tests__/**/*.test.ts"];
const domainTests = ["src/server/domain/**/__tests__/**/*.test.ts"];
const securityTests = [
    "src/pages/api/auth/**/__tests__/**/*.test.ts",
    "src/server/api/v1/shared/__tests__/auth.access.test.ts",
    "src/server/application/public/__tests__/detail-page-access.service.test.ts",
    "src/server/auth/**/__tests__/**/*.test.ts",
    "src/server/markdown/**/__tests__/**/*.test.ts",
    "src/server/security/**/__tests__/**/*.test.ts",
];
const clientTests = [
    "src/scripts/__tests__/album-new-page.test.ts",
    "src/scripts/__tests__/auth-nav-routing.test.ts",
    "src/scripts/__tests__/auth-state.test.ts",
    "src/scripts/__tests__/mermaid-interaction.dom.test.ts",
    "src/scripts/__tests__/overlay-dialog.test.ts",
    "src/scripts/__tests__/owner-gate.test.ts",
    "src/scripts/__tests__/password-protection.test.ts",
    "src/scripts/__tests__/progress-overlay-manager.test.ts",
    "src/scripts/__tests__/publish-editor-monaco-styles.test.ts",
    "src/scripts/__tests__/publish-save-redirect.test.ts",
    "src/scripts/__tests__/static-overlay-dialog-portal.test.ts",
    "src/scripts/article-detail/__tests__/ai-summary-card.test.ts",
    "src/scripts/layout/__tests__/enter-skeleton.test.ts",
    "src/scripts/layout/__tests__/sidebar-profile-sync.test.ts",
    "src/scripts/layout/__tests__/transition-hooks.test.ts",
    "src/scripts/layout/__tests__/transition-layout-utils.dom.test.ts",
];
const structuredProjectTests = [
    ...schemaTests,
    ...apiTests,
    ...domainTests,
    ...securityTests,
    ...clientTests,
];

export default defineConfig({
    resolve: {
        alias: {
            "astro:transitions/client": resolve(
                projectRootDir,
                "src/__tests__/mocks/astro-transitions-client.ts",
            ),
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
        environment: "node",
        setupFiles: [sharedSetupFile],
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
        projects: [
            {
                extends: true,
                test: {
                    name: "schema",
                    include: schemaTests,
                },
            },
            {
                extends: true,
                test: {
                    name: "api",
                    include: apiTests,
                    exclude: [...schemaTests, ...securityTests],
                },
            },
            {
                extends: true,
                test: {
                    name: "domain",
                    include: domainTests,
                },
            },
            {
                extends: true,
                test: {
                    name: "security",
                    include: securityTests,
                },
            },
            {
                extends: true,
                test: {
                    name: "client",
                    include: clientTests,
                    environment: "jsdom",
                    setupFiles: [sharedSetupFile, clientSetupFile],
                },
            },
            {
                extends: true,
                test: {
                    name: "core",
                    include: ["src/**/__tests__/**/*.test.ts"],
                    exclude: structuredProjectTests,
                },
            },
        ],
    },
});
