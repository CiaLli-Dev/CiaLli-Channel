import net from "node:net";
import os from "node:os";
import path from "node:path";

export const REQUIRED_HOST_PORTS = [
    { host: "0.0.0.0", port: 80, label: "proxy HTTP" },
    { host: "0.0.0.0", port: 443, label: "proxy HTTPS" },
    { host: "127.0.0.1", port: 6379, label: "redis" },
    { host: "127.0.0.1", port: 8055, label: "directus" },
    { host: "127.0.0.1", port: 9001, label: "minio-console" },
];

/**
 * @param {NodeJS.Platform} [platform]
 * @param {string} [release]
 * @returns {"linux" | "macos" | "wsl" | null}
 */
export function detectHostPlatform(
    platform = process.platform,
    release = os.release(),
) {
    if (platform === "darwin") {
        return "macos";
    }
    if (platform === "linux") {
        if (release.toLowerCase().includes("microsoft")) {
            return "wsl";
        }
        return "linux";
    }
    return null;
}

/**
 * @param {string} cwd
 * @returns {string}
 */
export function deriveComposeProjectName(cwd) {
    const raw = path.basename(cwd).toLowerCase();
    const normalized = raw.replace(/[^a-z0-9_-]/g, "");
    return normalized || "cialli-channel";
}

/**
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export async function isPortAvailable(port, host) {
    await new Promise((resolve) => setImmediate(resolve));
    return await new Promise((resolve) => {
        const targetHost = host === "0.0.0.0" ? "127.0.0.1" : host;
        const socket = net.createConnection({ host: targetHost, port });
        socket.setTimeout(500);
        socket.once("connect", () => {
            socket.destroy();
            resolve(false);
        });
        socket.once("timeout", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error) => {
            if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                (error.code === "ECONNREFUSED" ||
                    error.code === "EHOSTUNREACH" ||
                    error.code === "ENETUNREACH")
            ) {
                resolve(true);
                return;
            }
            resolve(false);
        });
    });
}
