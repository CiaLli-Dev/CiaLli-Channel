import { webcrypto } from "node:crypto";

import { badRequest } from "@/server/api/errors";

const MARKER = "CIALLI-VERIFY:";
const VERSION_PREFIX = "CL2:";
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

type ProtectedPayloadV2 = {
    v: 2;
    alg: "AES-GCM";
    kdf: "PBKDF2";
    hash: "SHA-256";
    it: number;
    s: string;
    iv: string;
    ct: string;
};

function toBase64Url(input: ArrayBuffer | Uint8Array | string): string {
    const buffer =
        typeof input === "string"
            ? Buffer.from(input, "utf8")
            : Buffer.from(
                  input instanceof ArrayBuffer ? new Uint8Array(input) : input,
              );
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function toStrictArrayBuffer(input: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = input;
    return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

async function deriveAesKey(password: string, salt: Uint8Array) {
    const encoder = new TextEncoder();
    const keyMaterial = await webcrypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );

    return await webcrypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toStrictArrayBuffer(salt),
            iterations: PBKDF2_ITERATIONS,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
    );
}

export async function encryptProtectedContent(
    html: string,
    password: string,
): Promise<string> {
    const cleanPassword = String(password || "").trim();
    if (!cleanPassword) {
        throw badRequest("PASSWORD_REQUIRED", "请输入密码");
    }

    const source = `${MARKER}${String(html || "")}`;
    const encoder = new TextEncoder();
    const salt = webcrypto.getRandomValues(
        new Uint8Array(new ArrayBuffer(SALT_BYTES)),
    );
    const iv = webcrypto.getRandomValues(
        new Uint8Array(new ArrayBuffer(IV_BYTES)),
    );
    const key = await deriveAesKey(cleanPassword, salt);

    const encrypted = await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv: toStrictArrayBuffer(iv) },
        key,
        encoder.encode(source),
    );

    const payload: ProtectedPayloadV2 = {
        v: 2,
        alg: "AES-GCM",
        kdf: "PBKDF2",
        hash: "SHA-256",
        it: PBKDF2_ITERATIONS,
        s: toBase64Url(salt),
        iv: toBase64Url(iv),
        ct: toBase64Url(encrypted),
    };

    return `${VERSION_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}
