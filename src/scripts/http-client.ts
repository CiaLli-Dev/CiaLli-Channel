import { ensureCsrfToken, getCsrfToken } from "@/utils/csrf";

export interface ApiResult {
    response: Response;
    data: Record<string, unknown> | null;
}

export function normalizeApiUrl(input: string): string {
    const [pathname, search = ""] = String(input || "").split("?");
    const normalizedPath = pathname.endsWith("/")
        ? pathname.slice(0, -1)
        : pathname;
    return search ? `${normalizedPath}?${search}` : normalizedPath;
}

export async function requestApi(
    url: string,
    init: RequestInit = {},
): Promise<ApiResult> {
    const csrfToken = getCsrfToken() || (await ensureCsrfToken());
    const isFormData =
        typeof FormData !== "undefined" &&
        Boolean(init.body) &&
        init.body instanceof FormData;
    const response = await fetch(normalizeApiUrl(url), {
        credentials: "include",
        headers: {
            Accept: "application/json",
            "x-csrf-token": csrfToken,
            ...(init.body && !isFormData
                ? { "Content-Type": "application/json" }
                : {}),
            ...((init.headers as Record<string, string>) || {}),
        },
        ...init,
    });
    const data: Record<string, unknown> | null = await response
        .json()
        .catch(() => null);
    return { response, data };
}

export function getApiErrorMessage(
    data: Record<string, unknown> | null,
    fallback: string,
): string {
    const error = data?.error as Record<string, unknown> | undefined;
    return (error?.message as string | undefined) || fallback;
}
