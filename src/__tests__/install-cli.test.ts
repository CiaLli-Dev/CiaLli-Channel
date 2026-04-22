import { describe, expect, it } from "vitest";

import { parseInstallArgs } from "../../scripts/install/args.mjs";
import {
    buildEnvValues,
    generateInstallerSecrets,
    renderEnvFile,
} from "../../scripts/install/env.mjs";
import {
    deriveComposeProjectName,
    detectHostPlatform,
} from "../../scripts/install/host.mjs";

describe("install cli args", () => {
    it("parses noninteractive install arguments", () => {
        const args = parseInstallArgs([
            "install",
            "--lang",
            "zh_CN",
            "--site-url",
            "https://example.com",
            "--env-file",
            ".env.prod",
            "--reset",
        ]);

        expect(args.lang).toBe("zh_CN");
        expect(args.siteUrl).toBe("https://example.com");
        expect(args.envFile).toBe(".env.prod");
        expect(args.reset).toBe(true);
        expect(args.interactive).toBe(false);
    });

    it("stays interactive when language or site url is missing", () => {
        expect(
            parseInstallArgs(["install", "--site-url", "https://example.com"])
                .interactive,
        ).toBe(true);
        expect(parseInstallArgs(["install", "--lang", "ja"]).interactive).toBe(
            true,
        );
    });

    it("rejects unknown languages", () => {
        expect(() =>
            parseInstallArgs([
                "install",
                "--lang",
                "fr",
                "--site-url",
                "https://example.com",
            ]),
        ).toThrow("不支持的语言");
    });
});

describe("installer env rendering", () => {
    it("renders installer-managed env including generated admin bootstrap values", () => {
        const envText = renderEnvFile(
            buildEnvValues({
                appPublicBaseUrl: "https://example.com",
                directusUrl: "http://127.0.0.1:8055",
                directusAdminEmail: "admin@local.invalid",
                directusAdminPassword: "admin-password",
                directusSecret: "directus-secret",
                directusStaticToken: "directus-static-token",
                postgresUser: "pg_deadbeef",
                postgresDb: "directus",
                postgresPassword: "postgres-password",
                minioRootUser: "minio_deadbeef",
                minioRootPassword: "minio-root-password",
                storageS3Key: "s3_deadbeef",
                storageS3Secret: "storage-s3-secret",
                bangumiTokenEncryptionKey: "bangumi-key",
                aiSummaryInternalSecret: "ai-secret",
            }),
        );

        expect(envText).toContain(
            "DIRECTUS_STATIC_TOKEN=directus-static-token",
        );
        expect(envText).toContain("POSTGRES_USER=pg_deadbeef");
        expect(envText).toContain("POSTGRES_DB=directus");
        expect(envText).toContain("MINIO_ROOT_USER=minio_deadbeef");
        expect(envText).toContain("DIRECTUS_ADMIN_EMAIL=admin@local.invalid");
        expect(envText).toContain("DIRECTUS_ADMIN_PASSWORD=admin-password");
        expect(envText).toContain("STORAGE_S3_KEY=s3_deadbeef");
    });

    it("generates required installer secrets and account values", () => {
        const fakeRandom = (size: number): Buffer => Buffer.alloc(size, 7);
        const secrets = generateInstallerSecrets(fakeRandom);

        expect(secrets.DIRECTUS_SECRET).toHaveLength(64);
        expect(secrets.POSTGRES_USER).toBe("pg_07070707");
        expect(secrets.POSTGRES_DB).toBe("directus");
        expect(secrets.MINIO_ROOT_USER).toBe("minio_07070707");
        expect(secrets.DIRECTUS_ADMIN_EMAIL).toBe("admin@local.invalid");
        expect(secrets.DIRECTUS_ADMIN_PASSWORD).toBe(
            Buffer.alloc(24, 7).toString("base64url"),
        );
        expect(secrets.STORAGE_S3_KEY).toBe("s3_07070707");
        expect(secrets.BANGUMI_TOKEN_ENCRYPTION_KEY).toBe(
            Buffer.alloc(32, 7).toString("base64"),
        );
        expect(secrets.DIRECTUS_STATIC_TOKEN).toHaveLength(48);
    });
});

describe("installer host helpers", () => {
    it("detects supported host platforms", () => {
        expect(detectHostPlatform("darwin", "")).toBe("macos");
        expect(detectHostPlatform("linux", "6.6.0-microsoft-standard")).toBe(
            "wsl",
        );
        expect(detectHostPlatform("linux", "6.6.0")).toBe("linux");
    });

    it("derives docker compose project name from cwd", () => {
        expect(deriveComposeProjectName("/tmp/CiaLli-Channel")).toBe(
            "cialli-channel",
        );
    });
});
