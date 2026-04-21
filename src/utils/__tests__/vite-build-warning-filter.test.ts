import { describe, expect, it } from "vitest";

import {
    isKnownBrowserCompatibilityNoise,
    shouldIgnoreBuildWarning,
} from "../vite-build-warning-filter";

describe("vite-build-warning-filter", () => {
    it("会过滤来自已知上游构建链的 browser compatibility 噪音", () => {
        expect(
            isKnownBrowserCompatibilityNoise({
                plugin: "vite:resolve",
                message:
                    'Module "node:fs" has been externalized for browser compatibility, imported by "/Users/test/project/node_modules/.pnpm/@astrojs+node@9.5.0/node_modules/@astrojs/node/dist/server.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.',
            }),
        ).toBe(true);
    });

    it("不会过滤来自业务源码的同类 warning", () => {
        expect(
            isKnownBrowserCompatibilityNoise({
                plugin: "vite:resolve",
                message:
                    'Module "node:fs" has been externalized for browser compatibility, imported by "/Users/test/project/src/client/demo.ts". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.',
            }),
        ).toBe(false);
    });

    it("不会过滤非 vite:resolve 或非该文案 warning", () => {
        expect(
            isKnownBrowserCompatibilityNoise({
                plugin: "commonjs",
                message:
                    'Module "node:fs" has been externalized for browser compatibility, imported by "/Users/test/project/node_modules/.pnpm/@astrojs+node@9.5.0/node_modules/@astrojs/node/dist/server.js".',
            }),
        ).toBe(false);

        expect(
            isKnownBrowserCompatibilityNoise({
                plugin: "vite:resolve",
                message: 'Circular dependency: "a" -> "b"',
            }),
        ).toBe(false);
    });

    it("shouldIgnoreBuildWarning 会保留现有的 dynamic-import 冲突过滤", () => {
        expect(
            shouldIgnoreBuildWarning({
                plugin: "vite:reporter",
                message:
                    '"demo" is dynamically imported by "/a.ts" but also statically imported by "/b.ts"',
            }),
        ).toBe(true);
    });

    it("shouldIgnoreBuildWarning 只会额外忽略白名单内的 browser compatibility warning", () => {
        expect(
            shouldIgnoreBuildWarning({
                plugin: "vite:resolve",
                message:
                    'Module "node:path" has been externalized for browser compatibility, imported by "/Users/test/project/node_modules/.pnpm/glob@13.0.6/node_modules/glob/dist/commonjs/index.min.js".',
            }),
        ).toBe(true);

        expect(
            shouldIgnoreBuildWarning({
                plugin: "vite:resolve",
                message:
                    'Module "node:path" has been externalized for browser compatibility, imported by "/Users/test/project/src/entry.ts".',
            }),
        ).toBe(false);
    });
});
