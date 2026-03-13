/**
 * Astro APIContext mock 工厂
 *
 * 构造用于 API handler 测试的 mock 请求上下文。
 */

type MockAPIContextOptions = {
    method?: string;
    url?: string;
    body?: unknown;
    params?: Record<string, string | undefined>;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
};

type MinimalAPIContext = {
    request: Request;
    url: URL;
    params: Record<string, string | undefined>;
    cookies: {
        get: (name: string) => { value: string } | undefined;
        set: (name: string, value: string, options?: unknown) => void;
        delete: (name: string, options?: unknown) => void;
    };
    locals: Record<string, unknown>;
};

export function createMockAPIContext(
    options: MockAPIContextOptions = {},
): MinimalAPIContext {
    const {
        method = "GET",
        url = "http://localhost:4321/api/v1/test",
        body,
        params = {},
        cookies = {},
        headers = {},
    } = options;

    const requestInit: RequestInit = {
        method,
        headers: {
            "Content-Type": "application/json",
            origin: "http://localhost:4321",
            ...headers,
        },
    };

    if (body !== undefined && method !== "GET") {
        requestInit.body = JSON.stringify(body);
    }

    const request = new Request(url, requestInit);
    const parsedUrl = new URL(url);

    const cookieStore = { ...cookies };

    return {
        request,
        url: parsedUrl,
        params,
        cookies: {
            get(name: string) {
                const value = cookieStore[name];
                return value !== undefined ? { value } : undefined;
            },
            set(name: string, value: string) {
                cookieStore[name] = value;
            },
            delete(name: string) {
                delete cookieStore[name];
            },
        },
        locals: { requestId: "test-req-id" },
    };
}

/** 便捷的响应体解析 */
export async function parseResponseJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
}
