import { describe, expect, it } from "vitest";

import {
    createInstallerI18n,
    normalizeInstallLanguage,
    resolveInstallLanguageChoice,
} from "../../scripts/install/i18n.mjs";

describe("installer i18n", () => {
    it("resolves supported installer languages and aliases", () => {
        expect(normalizeInstallLanguage("en")).toBe("en");
        expect(normalizeInstallLanguage("zh-cn")).toBe("zh_CN");
        expect(normalizeInstallLanguage("zh_TW")).toBe("zh_TW");
        expect(normalizeInstallLanguage("ja-jp")).toBe("ja");
        expect(normalizeInstallLanguage("fr")).toBeNull();
    });

    it("supports numeric and code-based language selection", () => {
        expect(resolveInstallLanguageChoice("1")).toBe("en");
        expect(resolveInstallLanguageChoice("2")).toBe("zh_CN");
        expect(resolveInstallLanguageChoice("3")).toBe("zh_TW");
        expect(resolveInstallLanguageChoice("4")).toBe("ja");
        expect(resolveInstallLanguageChoice("ja")).toBe("ja");
        expect(resolveInstallLanguageChoice("unknown")).toBeNull();
    });

    it("returns localized messages with fallback support", () => {
        expect(createInstallerI18n("en")("installComplete")).toContain(
            "Installation completed",
        );
        expect(createInstallerI18n("zh_CN")("installComplete")).toContain(
            "安装完成",
        );
        expect(createInstallerI18n("zh_TW")("installComplete")).toContain(
            "安裝完成",
        );
        expect(createInstallerI18n("ja")("installComplete")).toContain(
            "インストールが完了",
        );
    });
});
