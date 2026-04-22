#!/usr/bin/env node

import { parseInstallArgs } from "./args.mjs";
import { createInstallerDeps, runInstallFlow } from "./core.mjs";
import {
    createInstallerI18n,
    DEFAULT_INSTALL_LANGUAGE,
    resolveRequestedInstallLanguage,
} from "./i18n.mjs";

async function main() {
    const deps = createInstallerDeps();
    try {
        const args = parseInstallArgs(process.argv.slice(2));
        await runInstallFlow(args, deps);
    } catch (error) {
        const lang =
            resolveRequestedInstallLanguage(process.argv.slice(2)) ||
            DEFAULT_INSTALL_LANGUAGE;
        const t = createInstallerI18n(lang);
        const message =
            error instanceof Error ? error.message : t("unknownInstallError");
        deps.error(t("installFailed", { message }));
        process.exitCode = 1;
    }
}

await main();
