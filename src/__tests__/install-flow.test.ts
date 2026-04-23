import { beforeEach, describe, expect, it, vi } from "vitest";

import { runInstallFlow } from "../../scripts/install/core.mjs";

function createFakeDeps() {
    const commands: string[] = [];
    const writes: Array<{ path: string; contents: string }> = [];
    const logs: string[] = [];
    const prompts: string[] = [];
    const promptAnswers: string[] = [];
    const existingPaths = new Set<string>();
    const responses = new Map<string, string>();

    const deps = {
        cwd: "/repo",
        platform: "linux" as NodeJS.Platform,
        release: "6.6.0",
        async runCommand(command: string, args: string[]) {
            const key = `${command} ${args.join(" ")}`;
            commands.push(key);
            if (responses.has(key)) {
                return responses.get(key) || "";
            }
            if (key.includes("docker info")) {
                return "Server Version: 27";
            }
            if (key.includes("docker --version")) {
                return "Docker version 27.0.0";
            }
            if (key.includes("docker compose version")) {
                return "Docker Compose version v2.29.0";
            }
            if (key.includes("git lfs version")) {
                return "git-lfs/3.5.1";
            }
            if (key.includes("node scripts/seed/verify.mjs")) {
                return "[seed:verify] ok";
            }
            if (key.includes("docker volume ls")) {
                return "";
            }
            if (
                key.includes(
                    "docker compose --env-file /repo/.env -f docker-compose.yml ps -aq",
                )
            ) {
                return "";
            }
            if (
                key.includes(
                    "docker compose --env-file /repo/.env -f docker-compose.yml exec -T postgres sh -lc",
                )
            ) {
                return "role-uuid";
            }
            return "";
        },
        async writeFile(targetPath: string, contents: string) {
            writes.push({ path: targetPath, contents });
            existingPaths.add(targetPath);
        },
        async readFile() {
            return "";
        },
        async removeFile(targetPath: string) {
            existingPaths.delete(targetPath);
        },
        async fileExists(targetPath: string) {
            if (
                targetPath === "/repo/package.json" ||
                targetPath === "/repo/docker-compose.yml"
            ) {
                return true;
            }
            return existingPaths.has(targetPath);
        },
        fetch: vi.fn(async (url: string, init?: RequestInit) => {
            if (url === "http://127.0.0.1:8055/server/health") {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                });
            }
            if (url === "http://127.0.0.1:8055/auth/login") {
                return new Response(
                    JSON.stringify({
                        data: {
                            access_token: "access-token",
                        },
                    }),
                    { status: 200 },
                );
            }
            if (url === "http://127.0.0.1:8055/users/me?fields=id") {
                return new Response(
                    JSON.stringify({
                        data: {
                            id: "admin-user-id",
                        },
                    }),
                    { status: 200 },
                );
            }
            if (
                url === "http://127.0.0.1:8055/users/admin-user-id" &&
                init?.method === "PATCH"
            ) {
                return new Response(
                    JSON.stringify({ data: { id: "admin-user-id" } }),
                    {
                        status: 200,
                    },
                );
            }
            if (
                url ===
                "http://127.0.0.1:8055/items/app_site_settings?limit=1&fields=id%2Csettings_site&filter%5Bkey%5D%5B_eq%5D=default"
            ) {
                return new Response(JSON.stringify({ data: [] }), {
                    status: 200,
                });
            }
            if (
                url === "http://127.0.0.1:8055/items/app_site_settings" &&
                init?.method === "POST"
            ) {
                return new Response(
                    JSON.stringify({
                        data: {
                            id: "settings-id",
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response("not found", { status: 404 });
        }),
        async prompt(question: string) {
            prompts.push(question);
            return promptAnswers.shift() || "";
        },
        log: vi.fn((message: string) => {
            logs.push(message);
        }),
        error: vi.fn(),
        async portAvailable() {
            return true;
        },
    };

    return { commands, deps, logs, promptAnswers, prompts, responses, writes };
}

describe("installer flow", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("runs a fresh install, persists bootstrap credentials, and writes site language", async () => {
        const { commands, deps, logs, writes } = createFakeDeps();

        await runInstallFlow(
            {
                command: "install",
                lang: "en",
                siteUrl: "https://example.com",
                envFile: null,
                interactive: false,
                reset: false,
            },
            deps,
        );

        expect(
            commands.some((command) =>
                command.includes(
                    "docker compose --env-file /repo/.env -f docker-compose.yml build web worker",
                ),
            ),
        ).toBe(true);
        expect(
            commands.some((command) =>
                command.includes(
                    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c',
                ),
            ),
        ).toBe(true);
        expect(
            commands.some((command) =>
                command.includes(
                    "npx directus users create --email admin@example.com --password ",
                ),
            ),
        ).toBe(true);
        expect(writes).toHaveLength(2);
        expect(writes.at(-1)?.contents).toContain("DIRECTUS_STATIC_TOKEN=");
        expect(writes.at(-1)?.contents).toContain("DIRECTUS_ADMIN_PASSWORD=");
        expect(writes.at(-1)?.contents).toContain("POSTGRES_USER=dbu_");
        expect(writes.at(-1)?.contents).toContain("MINIO_ROOT_USER=minio_");
        expect(writes.at(-1)?.contents).toContain("STORAGE_S3_KEY=s3_");

        expect(deps.fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:8055/items/app_site_settings?limit=1&fields=id%2Csettings_site&filter%5Bkey%5D%5B_eq%5D=default",
            expect.any(Object),
        );
        expect(deps.fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:8055/items/app_site_settings",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    key: "default",
                    status: "published",
                    theme_preset: "purple",
                    settings_site: {
                        site: {
                            lang: "en",
                        },
                    },
                }),
            }),
        );

        expect(
            logs.some((message) => message.includes(".env written to")),
        ).toBe(true);
        expect(
            logs.some((message) =>
                message.includes("DIRECTUS_ADMIN_EMAIL=admin@example.com"),
            ),
        ).toBe(true);
        expect(
            logs.some((message) =>
                message.includes(
                    "All generated values are shown above and persisted in .env",
                ),
            ),
        ).toBe(true);
    });

    it("prompts for language before site url in interactive mode", async () => {
        const { deps, promptAnswers, prompts } = createFakeDeps();
        promptAnswers.push("1", "https://example.com");

        await runInstallFlow(
            {
                command: "install",
                lang: null,
                siteUrl: null,
                envFile: null,
                interactive: true,
                reset: false,
            },
            deps,
        );

        expect(prompts).toHaveLength(2);
        expect(prompts[0]).toContain("1. English");
        expect(prompts[1]).toContain("Public site URL");
    });

    it("refuses existing installations without reset", async () => {
        const { deps } = createFakeDeps();
        deps.fileExists = vi.fn(async (targetPath: string) => {
            if (
                targetPath === "/repo/package.json" ||
                targetPath === "/repo/docker-compose.yml" ||
                targetPath === "/repo/.env"
            ) {
                return true;
            }
            return false;
        });

        await expect(
            runInstallFlow(
                {
                    command: "install",
                    lang: "zh_CN",
                    siteUrl: "https://example.com",
                    envFile: null,
                    interactive: false,
                    reset: false,
                },
                deps,
            ),
        ).rejects.toThrow("检测到现有部署");
    });

    it("supports reset by tearing down compose resources first", async () => {
        const { commands, deps } = createFakeDeps();
        deps.fileExists = vi.fn(async (targetPath: string) => {
            if (
                targetPath === "/repo/package.json" ||
                targetPath === "/repo/docker-compose.yml" ||
                targetPath === "/repo/.env"
            ) {
                return true;
            }
            return false;
        });

        await runInstallFlow(
            {
                command: "install",
                lang: "zh_CN",
                siteUrl: "https://example.com",
                envFile: null,
                interactive: false,
                reset: true,
            },
            deps,
        );

        expect(
            commands.some((command) =>
                command.includes(
                    "docker compose --env-file /repo/.env -f docker-compose.yml down --volumes --remove-orphans",
                ),
            ),
        ).toBe(true);
    });

    it("fails when static token persistence request fails", async () => {
        const { deps } = createFakeDeps();
        deps.fetch = vi.fn(async (url, init) => {
            if (url === "http://127.0.0.1:8055/server/health") {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                });
            }
            if (url === "http://127.0.0.1:8055/auth/login") {
                return new Response(
                    JSON.stringify({
                        data: {
                            access_token: "access-token",
                        },
                    }),
                    { status: 200 },
                );
            }
            if (url === "http://127.0.0.1:8055/users/me?fields=id") {
                return new Response(
                    JSON.stringify({
                        data: {
                            id: "admin-user-id",
                        },
                    }),
                    { status: 200 },
                );
            }
            if (
                url === "http://127.0.0.1:8055/users/admin-user-id" &&
                init?.method === "PATCH"
            ) {
                return new Response("boom", { status: 500 });
            }
            return new Response("not found", { status: 404 });
        });

        await expect(
            runInstallFlow(
                {
                    command: "install",
                    lang: "en",
                    siteUrl: "https://example.com",
                    envFile: null,
                    interactive: false,
                    reset: false,
                },
                deps,
            ),
        ).rejects.toThrow("Failed to persist Directus static token");
    });
});
