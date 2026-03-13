export function json<T>(data: T, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
        ...init,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...(init?.headers ?? {}),
        },
    });
}

export function ok<T>(data: T, init?: ResponseInit): Response {
    return json(
        {
            ok: true,
            ...((data as object) || {}),
        },
        init,
    );
}

export function fail(message: string, status = 400, code?: string): Response {
    return json(
        {
            ok: false as const,
            error: {
                code: code || "UNKNOWN_ERROR",
                message,
            },
        },
        { status },
    );
}
