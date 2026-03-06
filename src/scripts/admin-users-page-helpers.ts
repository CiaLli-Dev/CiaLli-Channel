import I18nKey from "@/i18n/i18nKey";
import { t } from "@/scripts/i18n-runtime";

export type UnknownRecord = Record<string, unknown>;

const getStr = (value: unknown, fallback = ""): string =>
    String(value || fallback).trim();

const getStrOrNone = (value: unknown): string =>
    getStr(value) || t(I18nKey.adminUsersNone);

function renderCapabilityToggle(params: {
    userId: string;
    field:
        | "can_publish_articles"
        | "can_comment_articles"
        | "can_manage_diaries"
        | "can_comment_diaries"
        | "can_manage_albums"
        | "can_upload_files";
    checked: boolean;
    disabled: boolean;
}): string {
    return `<label class="inline-flex items-center">
        <input type="checkbox" data-user-id="${params.userId}" data-field="${params.field}" ${params.checked ? "checked" : ""} ${params.disabled ? "disabled" : ""} />
    </label>`;
}

export const renderUsersRows = (
    rows: UnknownRecord[],
    getUsersTableBody: () => HTMLTableSectionElement | null,
): void => {
    const usersTableBody = getUsersTableBody();
    if (!usersTableBody) return;
    if (!Array.isArray(rows) || rows.length === 0) {
        usersTableBody.innerHTML = `<tr><td colspan="10" class="py-4 text-60">${t(I18nKey.adminUsersNoUserData)}</td></tr>`;
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
            const permissionsRecord =
                typeof entry.permissions === "object" && entry.permissions
                    ? (entry.permissions as UnknownRecord)
                    : {};

            const userId = String(userRecord.id || "");
            const userEmail = String(userRecord.email || "");
            const username = String(profileRecord.username || "");
            const appRole = String(permissionsRecord.app_role || "member");
            const isPlatformAdmin = Boolean(entry.is_platform_admin);
            const readOnly = isPlatformAdmin;
            const roleCell = isPlatformAdmin
                ? `<span class="inline-flex items-center rounded-full px-2 py-1 text-xs bg-amber-500/12 text-amber-600">platform admin</span>`
                : `<select data-user-id="${userId}" data-field="app_role" class="rounded border border-(--line-divider) px-2 py-1 bg-black/5 dark:bg-white/5 text-75">
								<option value="member" ${appRole === "member" ? "selected" : ""}>member</option>
								<option value="admin" ${appRole === "admin" ? "selected" : ""}>site admin</option>
							</select>`;
            return `
					<tr class="border-b border-(--line-divider) text-75">
						<td class="py-2 pr-2">${userEmail}</td>
						<td class="py-2 pr-2">${username}</td>
						<td class="py-2 pr-2">
							${roleCell}
						</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_publish_articles", checked: Boolean(permissionsRecord.can_publish_articles), disabled: readOnly })}</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_comment_articles", checked: Boolean(permissionsRecord.can_comment_articles), disabled: readOnly })}</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_manage_diaries", checked: Boolean(permissionsRecord.can_manage_diaries), disabled: readOnly })}</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_comment_diaries", checked: Boolean(permissionsRecord.can_comment_diaries), disabled: readOnly })}</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_manage_albums", checked: Boolean(permissionsRecord.can_manage_albums), disabled: readOnly })}</td>
						<td class="py-2 pr-2">${renderCapabilityToggle({ userId, field: "can_upload_files", checked: Boolean(permissionsRecord.can_upload_files), disabled: readOnly })}</td>
						<td class="py-2 pr-2">
							<div class="flex items-center gap-2">
								<button class="text-xs text-(--primary) hover:underline ${readOnly ? "opacity-50 pointer-events-none" : ""}" data-action="save" data-user-id="${userId}">${t(I18nKey.interactionCommonSave)}</button>
								<button class="text-xs text-red-500 hover:underline" data-action="delete" data-user-id="${userId}" data-username="${username}">${t(I18nKey.adminUsersDeleteAccount)}</button>
							</div>
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
            value: getStrOrNone(item.reviewed_at),
        },
        {
            label: t(I18nKey.adminUsersSubmittedAt),
            value: getStrOrNone(item.date_created),
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
