#!/usr/bin/env node

import { spawn } from "node:child_process";

import {
    loadLocalEnv,
    resolveEnvMode,
    stripArgSeparators,
} from "./local-env.mjs";

function getPnpmCommand() {
    return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

const forwardedArgs = stripArgSeparators(process.argv.slice(2));
const mode = resolveEnvMode(forwardedArgs, "development");

loadLocalEnv({ mode });

const child = spawn(getPnpmCommand(), ["astro", "dev", ...forwardedArgs], {
    stdio: "inherit",
    env: process.env,
});

child.on("error", (error) => {
    console.error("[dev] 启动 Astro 开发服务器失败：", error);
    process.exit(1);
});

child.on("exit", (code, signal) => {
    if (signal) {
        console.error(`[dev] Astro 开发服务器被信号中断：${signal}`);
        process.exit(1);
    }

    process.exit(code ?? 1);
});
