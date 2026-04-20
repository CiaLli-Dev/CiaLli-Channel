#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { loadLocalEnv, resolveEnvMode } from "./local-env.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4321;
const DIST_ENTRY = path.join(process.cwd(), "dist", "server", "entry.mjs");

function exitWithUsage(message) {
    if (message) {
        console.error(`[preview:docker] ${message}`);
    }
    console.error(
        "[preview:docker] 用法：pnpm preview:docker -- [--host <host>] [--port <port>] [--mode <mode>]",
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

    return port;
}

function parseArgs(argv) {
    const options = {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === "--") {
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            console.log(
                "pnpm preview:docker -- [--host <host>] [--port <port>] [--mode <mode>]\n\n该命令仅预览现有的 Docker/Node 构建产物；若尚未构建，请先执行 pnpm build:docker。",
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

        if (argument === "--mode") {
            const value = argv[index + 1];
            if (!value) {
                exitWithUsage("--mode 缺少参数");
            }
            index += 1;
            continue;
        }

        if (argument.startsWith("--mode=")) {
            continue;
        }

        exitWithUsage(`不支持的参数：${argument}`);
    }

    return options;
}

function ensureBuildOutputExists() {
    if (existsSync(DIST_ENTRY)) {
        return;
    }

    console.error(
        `[preview:docker] 未找到 ${path.relative(process.cwd(), DIST_ENTRY)}，请先执行 \`pnpm build:docker\`。`,
    );
    process.exit(1);
}

const argv = process.argv.slice(2);
const mode = resolveEnvMode(argv, "production");

loadLocalEnv({ mode });

const options = parseArgs(process.argv);
ensureBuildOutputExists();

const child = spawn(process.execPath, [DIST_ENTRY], {
    stdio: "inherit",
    env: {
        ...process.env,
        HOST: options.host,
        PORT: String(options.port),
    },
});

child.on("error", (error) => {
    console.error("[preview:docker] 启动 Node 预览失败：", error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        console.error(`[preview:docker] 预览被信号中断：${signal}`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
