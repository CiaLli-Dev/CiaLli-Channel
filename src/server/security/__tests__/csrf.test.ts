import { describe, expect, it } from "vitest";
import type { APIContext } from "astro";

import {
    CSRF_COOKIE,
    ensureCsrfCookie,
    rotateCsrfCookie,
} from "@/server/security/csrf";

type CookieSetRecord = {
    name: string;
    value: string;
    options?: {
        httpOnly?: boolean;
        sameSite?: "lax" | "strict" | "none";
        secure?: boolean;
        path?: string;
        maxAge?: number;
    };
};

function createCsrfContext(params?: { url?: string; initialCookie?: string }): {
    context: APIContext;
    setRecords: CookieSetRecord[];
} {
    let cookieValue = params?.initialCookie;
    const setRecords: CookieSetRecord[] = [];
    const context = {
        url: new URL(params?.url || "http://localhost:4321/"),
        cookies: {
            get(name: string): { value: string } | undefined {
                if (name !== CSRF_COOKIE || !cookieValue) {
                    return undefined;
                }
                return { value: cookieValue };
            },
            set(
                name: string,
                value: string,
                options?: CookieSetRecord["options"],
            ): void {
                if (name === CSRF_COOKIE) {
                    cookieValue = value;
                }
                setRecords.push({ name, value, options });
            },
        },
    } as unknown as APIContext;

    return { context, setRecords };
}

describe("csrf cookie", () => {
    it("ensureCsrfCookie 会设置 HttpOnly + Lax + Path + MaxAge", () => {
        const { context, setRecords } = createCsrfContext({
            url: "http://localhost:4321/",
        });

        const token = ensureCsrfCookie(context);

        expect(token).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(setRecords).toHaveLength(1);
        expect(setRecords[0]).toMatchObject({
            name: CSRF_COOKIE,
            value: token,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 86400,
                secure: false,
            },
        });
    });

    it("ensureCsrfCookie 已存在时不重复 set", () => {
        const existingToken = "11111111-1111-4111-8111-111111111111";
        const { context, setRecords } = createCsrfContext({
            initialCookie: existingToken,
        });

        const token = ensureCsrfCookie(context);

        expect(token).toBe(existingToken);
        expect(setRecords).toHaveLength(0);
    });

    it("rotateCsrfCookie 会强制生成新 token 并写入 secure(https)", () => {
        const { context, setRecords } = createCsrfContext({
            url: "https://cialli.test/",
            initialCookie: "11111111-1111-4111-8111-111111111111",
        });

        const rotatedToken = rotateCsrfCookie(context);

        expect(rotatedToken).not.toBe("11111111-1111-4111-8111-111111111111");
        expect(setRecords).toHaveLength(1);
        expect(setRecords[0]?.options?.secure).toBe(true);
        expect(setRecords[0]?.options?.httpOnly).toBe(true);
    });
});
