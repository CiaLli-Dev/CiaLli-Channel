/**
 * 自定义断言助手
 *
 * 简化 API 响应的常见断言模式。
 */

import { expect } from "vitest";

type OkResponse = {
    ok: true;
    [key: string]: unknown;
};

type FailResponse = {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};

/** 断言响应为成功（200 + ok: true） */
export async function expectOk(response: Response): Promise<OkResponse> {
    expect(response.status).toBe(200);
    const body = (await response.json()) as OkResponse;
    expect(body.ok).toBe(true);
    return body;
}

/** 断言响应为失败（指定 status + ok: false + 可选 code） */
export async function expectFail(
    response: Response,
    status: number,
    code?: string,
): Promise<FailResponse> {
    expect(response.status).toBe(status);
    const body = (await response.json()) as FailResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    if (code) {
        expect(body.error.code).toBe(code);
    }
    return body;
}
