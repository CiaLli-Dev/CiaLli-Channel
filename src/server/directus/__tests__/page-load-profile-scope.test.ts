import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function collectAstroFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                return await collectAstroFiles(fullPath);
            }
            if (entry.isFile() && fullPath.endsWith(".astro")) {
                return [fullPath];
            }
            return [] as string[];
        }),
    );
    return files.flat();
}

describe("pages loadProfileForViewer scope guard", () => {
    it("所有调用 loadProfileForViewer 的页面都必须显式声明 Directus scope", async () => {
        const pagesRoot = resolve(process.cwd(), "src/pages");
        const astroFiles = await collectAstroFiles(pagesRoot);

        const loadProfileCallMarker = "loadProfileForViewer(";
        const scopeMarkerRegex = /runWithDirectus(?:Public|User|Service)Access/;

        const filesUsingLoadProfile = (
            await Promise.all(
                astroFiles.map(async (filePath) => {
                    const content = await readFile(filePath, "utf8");
                    return content.includes(loadProfileCallMarker)
                        ? { filePath, content }
                        : null;
                }),
            )
        ).filter((item): item is { filePath: string; content: string } =>
            Boolean(item),
        );

        const missingScopeFiles = filesUsingLoadProfile
            .filter((item) => !scopeMarkerRegex.test(item.content))
            .map((item) => relative(process.cwd(), item.filePath));

        expect(
            missingScopeFiles,
            `以下页面调用了 loadProfileForViewer 但未声明 Directus scope:\n${missingScopeFiles.join("\n")}`,
        ).toEqual([]);
    });
});
