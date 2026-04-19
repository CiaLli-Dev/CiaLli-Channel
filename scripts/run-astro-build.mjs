#!/usr/bin/env node

import { spawn } from "node:child_process";

import {
    loadLocalEnv,
    resolveEnvMode,
    stripArgSeparators,
} from "./local-env.mjs";

const VALID_TARGETS = new Set(["vercel", "docker"]);

function getPnpmCommand() {
    return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function resolveTarget(argv) {
    const target = String(argv[2] || "vercel")
        .trim()
        .toLowerCase();
    if (!VALID_TARGETS.has(target)) {
        console.error(
            `[build] 不支持的部署目标：${target}。可选值：${Array.from(VALID_TARGETS).join(", ")}`,
        );
        process.exit(1);
    }
    return target;
}

const target = resolveTarget(process.argv);
const forwardedArgs = stripArgSeparators(process.argv.slice(3));
const mode = resolveEnvMode(forwardedArgs, "production");

loadLocalEnv({ mode });

const child = spawn(getPnpmCommand(), ["astro", "build", ...forwardedArgs], {
    stdio: "inherit",
    env: {
        ...process.env,
        DEPLOY_TARGET: target,
    },
});

child.on("error", (error) => {
    console.error("[build] 启动 Astro 构建失败：", error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        console.error(`[build] Astro 构建被信号中断：${signal}`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
