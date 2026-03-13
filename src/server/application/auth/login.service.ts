import {
    DirectusAuthError,
    directusGetMe,
    directusLogin,
    pickPublicUserInfo,
    type DirectusAuthTokens,
    type PublicUserInfo,
} from "@/server/directus-auth";
import { normalizeRegistrationRequestId } from "@/server/auth/registration-request-cookie";
import { findRegistrationRequestById } from "@/server/repositories/auth/registration-request.repository";

export type LoginCommand = {
    email: string;
    password: string;
    registrationRequestCookie?: string;
};

export type LoginResult =
    | {
          ok: true;
          tokens: DirectusAuthTokens;
          user: PublicUserInfo;
          clearRegistrationCookie: boolean;
      }
    | {
          ok: false;
          status: 401 | 500;
      };

async function fetchPublicUserInfo(
    accessToken: string,
    fallback: PublicUserInfo,
): Promise<PublicUserInfo> {
    try {
        const me = await directusGetMe({ accessToken });
        const picked = pickPublicUserInfo(me);
        return {
            id: picked.id || fallback.id,
            email: picked.email || fallback.email,
            name: picked.name || fallback.name,
            avatarUrl: picked.avatarUrl || fallback.avatarUrl,
        };
    } catch {
        return fallback;
    }
}

async function shouldClearRegistrationCookieOnLogin(
    cookieValue: string | undefined,
    userId: string,
): Promise<boolean> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
        return false;
    }

    const requestId = normalizeRegistrationRequestId(cookieValue);
    if (!requestId) {
        return false;
    }

    try {
        const row = await findRegistrationRequestById(requestId);
        if (!row) {
            return true;
        }
        const status = String(row.request_status || "").trim();
        const approvedUserId = String(row.approved_user_id || "").trim();
        return status === "approved" && approvedUserId === normalizedUserId;
    } catch (error) {
        console.warn(
            "[application/auth/login] skip registration cookie clear check:",
            error,
        );
        return false;
    }
}

/**
 * 登录编排只负责认证、取回当前用户公开信息与注册申请清理判定。
 * Cookie 写入与响应映射留在 Route 层。
 */
export async function loginWithPassword(
    command: LoginCommand,
): Promise<LoginResult> {
    try {
        const tokens = await directusLogin({
            email: command.email,
            password: command.password,
        });
        const fallbackUser: PublicUserInfo = {
            id: "",
            email: command.email,
            name: command.email,
        };
        const user = await fetchPublicUserInfo(
            tokens.accessToken,
            fallbackUser,
        );

        return {
            ok: true,
            tokens,
            user,
            clearRegistrationCookie: await shouldClearRegistrationCookieOnLogin(
                command.registrationRequestCookie,
                user.id,
            ),
        };
    } catch (error) {
        return {
            ok: false,
            status:
                error instanceof DirectusAuthError &&
                error.directusStatus === 401
                    ? 401
                    : 500,
        };
    }
}
