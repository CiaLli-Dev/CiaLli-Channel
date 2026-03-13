/**
 * 客户端 CSRF Token 读取工具
 *
 * 从服务端注入的 <meta name="cialli-csrf-token"> 读取值，
 * 用于在写请求中附加 x-csrf-token header。
 */
function readCsrfTokenFromMeta(): string {
    const element = document.querySelector('meta[name="cialli-csrf-token"]');
    if (!(element instanceof HTMLMetaElement)) {
        return "";
    }
    return element.content || "";
}

export function getCsrfToken(): string {
    const token = readCsrfTokenFromMeta();
    if (!token) {
        // 首次调用时异步触发 token 拉取，兼容仍在直接调用 getCsrfToken() 的旧逻辑。
        void ensureCsrfToken();
    }
    return token;
}

let csrfRequestTask: Promise<string> | null = null;

function ensureCsrfMetaElement(): HTMLMetaElement {
    const existing = document.querySelector('meta[name="cialli-csrf-token"]');
    if (existing instanceof HTMLMetaElement) {
        return existing;
    }
    const meta = document.createElement("meta");
    meta.name = "cialli-csrf-token";
    document.head.appendChild(meta);
    return meta;
}

export async function ensureCsrfToken(): Promise<string> {
    const existing = readCsrfTokenFromMeta();
    if (existing) {
        return existing;
    }
    if (csrfRequestTask) {
        return csrfRequestTask;
    }

    csrfRequestTask = (async () => {
        try {
            const response = await fetch("/api/auth/csrf", {
                method: "GET",
                credentials: "include",
                headers: {
                    Accept: "application/json",
                },
            });
            if (!response.ok) {
                return "";
            }
            const data = (await response.json().catch(() => null)) as {
                ok?: boolean;
                token?: string;
            } | null;
            const token =
                data && data.ok && typeof data.token === "string"
                    ? data.token
                    : "";
            if (token) {
                ensureCsrfMetaElement().content = token;
            }
            return token;
        } catch {
            return "";
        }
    })().finally(() => {
        csrfRequestTask = null;
    });

    return csrfRequestTask;
}
