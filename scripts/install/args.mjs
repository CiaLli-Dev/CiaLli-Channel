import {
    createInstallerI18n,
    DEFAULT_INSTALL_LANGUAGE,
    formatSupportedInstallLanguages,
    normalizeInstallLanguage,
} from "./i18n.mjs";

/**
 * @typedef {Object} InstallArgs
 * @property {"install"} command
 * @property {"en" | "zh_CN" | "zh_TW" | "ja" | null} lang
 * @property {string | null} siteUrl
 * @property {string | null} envFile
 * @property {boolean} reset
 * @property {boolean} interactive
 */

/**
 * @param {string[]} argv
 * @returns {InstallArgs}
 */
export function parseInstallArgs(argv) {
    const t = createInstallerI18n(DEFAULT_INSTALL_LANGUAGE);
    const [command = "install", ...rest] = argv;
    if (command !== "install") {
        throw new Error(t("unknownCommand", { command }));
    }

    /** @type {InstallArgs} */
    const args = {
        command: "install",
        lang: null,
        siteUrl: null,
        envFile: null,
        reset: false,
        interactive: true,
    };

    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === "--") {
            continue;
        }
        if (token === "--reset") {
            args.reset = true;
            continue;
        }
        if (token === "--lang") {
            const rawLang = rest[index + 1] || null;
            if (!rawLang) {
                throw new Error(
                    t("missingArgumentValue", {
                        option: "--lang",
                    }),
                );
            }
            const lang = normalizeInstallLanguage(rawLang);
            if (!lang) {
                throw new Error(
                    t("invalidLanguage", {
                        lang: rawLang,
                        supported: formatSupportedInstallLanguages(),
                    }),
                );
            }
            args.lang = lang;
            index += 1;
            continue;
        }
        if (token === "--site-url") {
            if (!rest[index + 1]) {
                throw new Error(
                    t("missingArgumentValue", {
                        option: "--site-url",
                    }),
                );
            }
            args.siteUrl = rest[index + 1] || null;
            index += 1;
            continue;
        }
        if (token === "--env-file") {
            if (!rest[index + 1]) {
                throw new Error(
                    t("missingArgumentValue", {
                        option: "--env-file",
                    }),
                );
            }
            args.envFile = rest[index + 1] || null;
            index += 1;
            continue;
        }
        throw new Error(t("unknownArgument", { token }));
    }

    args.interactive = !(args.lang && args.siteUrl);

    return args;
}
