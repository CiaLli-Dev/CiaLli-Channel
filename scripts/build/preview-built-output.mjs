#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "4321";
const WORKSPACE_ROOT = process.cwd();
const ENTRYPOINT_PATH = path.join(
    WORKSPACE_ROOT,
    "dist",
    "server",
    "entry.mjs",
);

function exitWithUsage(message) {
    if (message) {
        console.error(`[preview] ${message}`);
    }
    console.error(
        "[preview] 用法：pnpm preview -- [--host <host>] [--port <port>]",
    );
    process.exit(1);
}

function parsePort(value) {
    if (!/^\d+$/u.test(value)) {
        exitWithUsage(`无效端口：${value}`);
    }

    const port = Number.parseInt(value, 10);
    if (port < 1 || port > 65535) {
        exitWithUsage(`端口超出范围：${value}`);
    }

    return String(port);
}

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === "--") {
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            console.log(
                "pnpm preview -- [--host <host>] [--port <port>]\n\n该命令直接启动当前 Node 适配器构建产物；若尚未构建，请先执行 pnpm build。",
            );
            process.exit(0);
        }

        if (argument === "--host") {
            const value = argv[index + 1];
            if (!value) {
                exitWithUsage("--host 缺少参数");
            }
            options.host = value;
            index += 1;
            continue;
        }

        if (argument === "--port") {
            const value = argv[index + 1];
            if (!value) {
                exitWithUsage("--port 缺少参数");
            }
            options.port = parsePort(value);
            index += 1;
            continue;
        }

        exitWithUsage(`不支持的参数：${argument}`);
    }

    return options;
}

function ensureBuildOutputExists() {
    if (existsSync(ENTRYPOINT_PATH)) {
        return;
    }

    console.error("[preview] 未找到可预览的构建产物，请先执行 `pnpm build`。");
    console.error(
        `[preview] 缺失：${path.relative(WORKSPACE_ROOT, ENTRYPOINT_PATH)}`,
    );
    process.exit(1);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    ensureBuildOutputExists();

    const child = spawn(process.execPath, [ENTRYPOINT_PATH], {
        cwd: WORKSPACE_ROOT,
        env: {
            ...process.env,
            HOST: options.host,
            PORT: options.port,
        },
        stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 0);
    });
}

main();
