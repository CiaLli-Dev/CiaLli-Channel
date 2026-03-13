import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";
import {
    buildSiteDateFormatContext,
    formatSiteDateTime,
} from "@/utils/date-utils";

export type UnknownRecord = Record<string, unknown>;

const escapeHtml = (raw: unknown): string =>
    String(raw || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

const getStr = (value: unknown, fallback = ""): string =>
    String(value || fallback).trim();

const getStrOrNone = (value: unknown): string =>
    getStr(value) || t(I18nKey.adminUsersNone);

const formatAdminDateOrNone = (value: unknown): string => {
    if (typeof window === "undefined") {
        return getStrOrNone(value);
    }
    const siteDateContext = buildSiteDateFormatContext(
        window.__CIALLI_RUNTIME_SETTINGS__,
    );
    return (
        formatSiteDateTime(getStr(value), siteDateContext) ||
        getStrOrNone(value)
    );
};

const resolveRoleLabel = (
    userRecord: UnknownRecord,
    appRole: string,
): string => {
    const rawRole = userRecord.role;
    if (typeof rawRole === "object" && rawRole) {
        const roleName = getStr((rawRole as UnknownRecord).name);
        if (roleName) {
            return roleName;
        }
    }
    if (typeof rawRole === "string" && getStr(rawRole)) {
        return getStr(rawRole);
    }
    return appRole === "admin" ? "Site Admin" : "Member";
};

const resolveRoleBadgeClass = (roleLabel: string): string => {
    if (roleLabel === "Administrator") {
        return "bg-rose-500/12 text-rose-600 dark:text-rose-300";
    }
    if (roleLabel === "Site Admin") {
        return "bg-amber-500/12 text-amber-600 dark:text-amber-300";
    }
    if (roleLabel === "Member") {
        return "bg-sky-500/12 text-sky-600 dark:text-sky-300";
    }
    return "bg-black/5 text-75 dark:bg-white/10";
};

export const renderUsersRows = (
    rows: UnknownRecord[],
    getUsersTableBody: () => HTMLTableSectionElement | null,
): void => {
    const usersTableBody = getUsersTableBody();
    if (!usersTableBody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
        usersTableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-60">${t(I18nKey.adminUsersNoUserData)}</td></tr>`;
        return;
    }
    usersTableBody.innerHTML = rows
        .map((entry) => {
            const userRecord =
                typeof entry.user === "object" && entry.user
                    ? (entry.user as UnknownRecord)
                    : {};
            const profileRecord =
                typeof entry.profile === "object" && entry.profile
                    ? (entry.profile as UnknownRecord)
                    : {};

            const userId = String(userRecord.id || "");
            const userEmail = String(userRecord.email || "");
            const username = String(profileRecord.username || "");
            const appRole = String(
                (entry.permissions as UnknownRecord | undefined)?.app_role ||
                    "member",
            );
            const roleLabel = resolveRoleLabel(userRecord, appRole);
            // 关键渲染字段统一进行 HTML 转义，避免拼接 innerHTML 时出现注入。
            const safeUserId = escapeHtml(userId);
            const safeUserEmail = escapeHtml(userEmail);
            const safeUsername = escapeHtml(username);
            const safeRoleLabel = escapeHtml(roleLabel);
            const roleCell = `<span class="inline-flex items-center rounded-full px-2 py-1 text-xs ${resolveRoleBadgeClass(roleLabel)}">${safeRoleLabel}</span>`;
            return `
					<tr class="border-b border-(--line-divider) text-75">
						<td class="py-2 pr-2">${safeUserEmail}</td>
						<td class="py-2 pr-2">${safeUsername}</td>
						<td class="py-2 pr-2">${roleCell}</td>
						<td class="py-2 pr-2">
							<button class="text-xs text-red-500 hover:underline" data-action="delete" data-user-id="${safeUserId}" data-username="${safeUsername}" data-email="${safeUserEmail}">${t(I18nKey.adminUsersDeleteAccount)}</button>
						</td>
					</tr>
				`;
        })
        .join("");
};

export const renderRegistrationRows = (
    rows: UnknownRecord[],
    getRegistrationTableBody: () => HTMLTableSectionElement | null,
    registrationRequestMap: Map<string, UnknownRecord>,
): void => {
    const registrationTableBody = getRegistrationTableBody();
    if (!registrationTableBody) {
        return;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        registrationTableBody.innerHTML = `<tr><td colspan="2" class="py-4 text-60">${t(I18nKey.adminUsersNoRegistrationData)}</td></tr>`;
        registrationRequestMap.clear();
        return;
    }
    registrationRequestMap.clear();
    registrationTableBody.innerHTML = rows
        .map((item) => {
            const id = String(item.id || "").trim();
            if (id) {
                registrationRequestMap.set(id, item);
            }
            const avatarFile = String(item.avatar_file || "").trim();
            const avatarHtml = avatarFile
                ? `<img src="/api/v1/public/assets/${encodeURIComponent(avatarFile)}?width=72&height=72&fit=cover" class="w-10 h-10 rounded-full object-cover border border-(--line-divider)" alt="avatar" loading="lazy" />`
                : `<span class="inline-flex w-10 h-10 rounded-full items-center justify-center text-xs text-50 border border-(--line-divider)">${t(I18nKey.adminUsersNone)}</span>`;
            const username =
                String(item.username || "").trim() ||
                t(I18nKey.adminUsersUnnamedUser);
            const rowAttrs = id
                ? `data-registration-action="detail" data-registration-id="${id}"`
                : "";
            return `
					<tr class="border-b border-(--line-divider) text-75 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors" ${rowAttrs}>
						<td class="py-2 pr-2">${avatarHtml}</td>
						<td class="py-2 pr-2">
							<div class="flex items-center justify-between gap-3">
								<span>${username}</span>
								<span class="text-xs text-(--primary)">${t(I18nKey.adminUsersViewDetail)}</span>
							</div>
						</td>
					</tr>
				`;
        })
        .join("");
};

type DetailContentItem = {
    label: string;
    value: string;
    tone?: "primary";
    fullWidth?: boolean;
};

function buildDetailFields(item: UnknownRecord): DetailContentItem[] {
    const status = getStr(item.request_status);
    const username = getStr(item.username) || t(I18nKey.adminUsersUnnamedUser);
    return [
        {
            label: t(I18nKey.meSettingsUsernameLabel),
            value: username,
            tone: "primary" as const,
        },
        {
            label: t(I18nKey.authEmailLabel),
            value: getStrOrNone(item.email),
        },
        {
            label: t(I18nKey.meSettingsDisplayNameLabel),
            value: getStrOrNone(item.display_name),
        },
        {
            label: t(I18nKey.adminUsersRegistrationStatus),
            value: status || "unknown",
        },
        {
            label: t(I18nKey.adminUsersRejectReason),
            value: getStrOrNone(item.reject_reason),
        },
        {
            label: t(I18nKey.adminUsersReviewedBy),
            value: getStrOrNone(item.reviewed_by),
        },
        {
            label: t(I18nKey.adminUsersReviewedAt),
            value: formatAdminDateOrNone(item.reviewed_at),
        },
        {
            label: t(I18nKey.adminUsersSubmittedAt),
            value: formatAdminDateOrNone(item.date_created),
        },
        {
            label: t(I18nKey.adminUsersRegistrationReason),
            value: getStrOrNone(item.registration_reason),
            fullWidth: true,
        },
    ];
}

export const buildRegistrationDetailContent = (item: UnknownRecord) => {
    const status = getStr(item.request_status);
    return {
        status,
        content: buildDetailFields(item),
    };
};
