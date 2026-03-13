/**
 * 构建带 redirect 参数的登录 URL。
 * 自动拼接当前路径，防御 open redirect 和登录页自身循环。
 */
export function buildLoginUrl(): string {
    const loginPath = "/auth/login";
    try {
        const pathname = String(window.location.pathname || "/");
        const search = String(window.location.search || "");
        const hash = String(window.location.hash || "");
        const redirect = `${pathname}${search}${hash}` || "/";

        if (!redirect.startsWith("/") || redirect.startsWith("//")) {
            return loginPath;
        }
        if (pathname === "/login" || pathname === loginPath) {
            return loginPath;
        }

        const params = new URLSearchParams({ redirect });
        return `${loginPath}?${params.toString()}`;
    } catch {
        return loginPath;
    }
}
