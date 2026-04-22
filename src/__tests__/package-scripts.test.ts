import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageJsonScripts {
    lint?: string;
    "install:host"?: string;
}

interface PackageJsonShape {
    scripts?: PackageJsonScripts;
    bin?: {
        "cialli-install"?: string;
    };
}

function readPackageJson(): PackageJsonShape {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    return JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
    ) as PackageJsonShape;
}

describe("package.json scripts", () => {
    it("uses single-threaded ESLint for the lint script", () => {
        const packageJson = readPackageJson();

        expect(packageJson.scripts?.lint).toContain("--concurrency off");
    });

    it("exposes the global installer bin and local helper script", () => {
        const packageJson = readPackageJson();

        expect(packageJson.bin?.["cialli-install"]).toBe(
            "./scripts/install/cli.mjs",
        );
        expect(packageJson.scripts?.["install:host"]).toBe(
            "node ./scripts/install/cli.mjs install",
        );
    });
});
