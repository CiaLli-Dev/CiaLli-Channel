import { directusLogout } from "@/server/directus-auth";

/**
 * 退出登录时远端注销失败不应阻塞本地 cookie 清理。
 */
export async function logoutWithRefreshToken(
    refreshToken: string,
): Promise<void> {
    if (!refreshToken.trim()) {
        return;
    }

    try {
        await directusLogout({ refreshToken });
    } catch {
        // token 可能已失效或已被轮换，本地仍应继续清理。
    }
}
