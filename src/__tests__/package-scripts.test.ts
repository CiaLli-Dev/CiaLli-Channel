import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageJsonScripts {
    lint?: string;
}

interface PackageJsonShape {
    scripts?: PackageJsonScripts;
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
});
