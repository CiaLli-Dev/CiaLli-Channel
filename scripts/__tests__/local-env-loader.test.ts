import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    loadLocalEnv,
    resolveEnvMode,
    stripArgSeparators,
} from "../local-env.mjs";

describe("resolveEnvMode", () => {
    it("supports default mode and explicit --mode forms", () => {
        expect(resolveEnvMode([], "development")).toBe("development");
        expect(resolveEnvMode(["--mode", "staging"], "development")).toBe(
            "staging",
        );
        expect(resolveEnvMode(["--mode=production"], "development")).toBe(
            "production",
        );
    });
});

describe("stripArgSeparators", () => {
    it("removes passthrough separators before forwarding CLI args", () => {
        expect(stripArgSeparators(["--", "--host", "127.0.0.1"])).toEqual([
            "--host",
            "127.0.0.1",
        ]);
    });
});

describe("loadLocalEnv", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tempDirs
                .splice(0)
                .map((tempDir) =>
                    rm(tempDir, { recursive: true, force: true }),
                ),
        );
    });

    it("merges env files by precedence while preserving external variables", async () => {
        const tempDir = await mkdtemp(
            path.join(os.tmpdir(), "mizuki-local-env-loader-"),
        );
        tempDirs.push(tempDir);

        await writeFile(
            path.join(tempDir, ".env"),
            ["FROM_ENV=base", "SHARED=base", "PRESERVE=from-env", ""].join(
                "\n",
            ),
            "utf8",
        );
        await writeFile(
            path.join(tempDir, ".env.local"),
            ["FROM_LOCAL=local", "SHARED=local", ""].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(tempDir, ".env.production"),
            ["FROM_MODE=production", "SHARED=mode", ""].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(tempDir, ".env.production.local"),
            [
                "FROM_MODE_LOCAL=production-local",
                "SHARED=mode-local",
                "PRESERVE=from-mode-local",
                "",
            ].join("\n"),
            "utf8",
        );

        const processEnv = {
            EXISTING_ONLY: "outside",
            PRESERVE: "outside",
        };

        const result = loadLocalEnv({
            rootDir: tempDir,
            mode: "production",
            processEnv,
        });

        expect(result.mode).toBe("production");
        expect(result.loadedFiles).toEqual([
            ".env",
            ".env.local",
            ".env.production",
            ".env.production.local",
        ]);
        expect(processEnv).toEqual({
            EXISTING_ONLY: "outside",
            PRESERVE: "outside",
            FROM_ENV: "base",
            FROM_LOCAL: "local",
            FROM_MODE: "production",
            FROM_MODE_LOCAL: "production-local",
            SHARED: "mode-local",
        });
    });
});
