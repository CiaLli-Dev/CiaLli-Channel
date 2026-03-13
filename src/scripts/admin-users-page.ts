import I18nKey from "@/i18n/i18nKey";
import { t, tFmt } from "@/scripts/i18n-runtime";
import { showConfirmDialog } from "@/scripts/dialogs";
import { showOverlayDialog } from "@/scripts/overlay-dialog";
import { runWithTask } from "@/scripts/progress-overlay-manager";
import { getApiErrorMessage, requestApi as api } from "@/scripts/http-client";
import {
    type UnknownRecord,
    renderUsersRows as renderUsersRowsImpl,
    renderRegistrationRows as renderRegistrationRowsImpl,
    buildRegistrationDetailContent,
} from "@/scripts/admin-users-page-helpers";

const getUsersTableBody = (): HTMLTableSectionElement | null =>
    document.getElementById(
        "admin-users-table",
    ) as HTMLTableSectionElement | null;
const getRegisterEnabledInput = (): HTMLInputElement | null =>
    document.getElementById(
        "admin-register-enabled",
    ) as HTMLInputElement | null;
const getRegisterMessage = (): HTMLElement | null =>
    document.getElementById("admin-register-msg");
const getRegistrationTableBody = (): HTMLTableSectionElement | null =>
    document.getElementById(
        "admin-registration-table",
    ) as HTMLTableSectionElement | null;
const getRegistrationMessage = (): HTMLElement | null =>
    document.getElementById("admin-registration-msg");
const getRegistrationStatusSelect = (): HTMLSelectElement | null =>
    document.getElementById(
        "admin-registration-status",
    ) as HTMLSelectElement | null;

const setRegistrationMessage = (message: string) => {
    const registrationMessage = getRegistrationMessage();
    if (!registrationMessage) {
        return;
    }
    registrationMessage.textContent = String(message || "");
};

const setRegisterMessage = (message: string) => {
    const registerMessage = getRegisterMessage();
    if (!registerMessage) {
        return;
    }
    registerMessage.textContent = String(message || "");
};

const resolveErrorMessage = (data: UnknownRecord | null, fallback: string) => {
    const error = data?.error as UnknownRecord | undefined;
    const code = String(error?.code || "");
    if (code === "REGISTER_DISABLED") {
        return t(I18nKey.adminUsersRegisterDisabled);
    }
    if (code === "EMAIL_EXISTS") {
        return t(I18nKey.adminUsersEmailExists);
    }
    if (code === "USERNAME_EXISTS") {
        return t(I18nKey.adminUsersUsernameExists);
    }
    if (code === "REGISTRATION_REQUEST_EXISTS") {
        return t(I18nKey.adminUsersRegistrationExists);
    }
    if (code === "REGISTRATION_STATUS_CONFLICT") {
        return t(I18nKey.adminUsersRegistrationStatusConflict);
    }
    return getApiErrorMessage(
        data,
        fallback || t(I18nKey.interactionCommonRequestFailed),
    );
};

const registrationRequestMap = new Map<string, UnknownRecord>();

const renderUsersRows = (rows: UnknownRecord[]): void => {
    renderUsersRowsImpl(rows, getUsersTableBody);
};

const renderRegistrationRows = (rows: UnknownRecord[]): void => {
    renderRegistrationRowsImpl(
        rows,
        getRegistrationTableBody,
        registrationRequestMap,
    );
};

const loadUsers = async (): Promise<void> => {
    const { response, data } = await api("/api/v1/admin/users?limit=200");
    if (!response.ok || !data?.ok) {
        renderUsersRows([]);
        return;
    }
    renderUsersRows((data.items as UnknownRecord[]) || []);
};

const loadRegisterSwitch = async (): Promise<void> => {
    const registerEnabledInput = getRegisterEnabledInput();
    const { response, data } = await api("/api/v1/admin/settings/site");
    if (!response.ok || !data?.ok) {
        setRegisterMessage(
            resolveErrorMessage(data, t(I18nKey.adminUsersLoadSwitchFailed)),
        );
        return;
    }
    const settings = data?.settings as UnknownRecord | undefined;
    const auth = settings?.auth as UnknownRecord | undefined;
    const enabled = Boolean(auth?.register_enabled);
    if (registerEnabledInput) {
        registerEnabledInput.checked = enabled;
    }
    setRegisterMessage("");
};

const loadRegistrationRequests = async (): Promise<void> => {
    const registrationStatusSelect = getRegistrationStatusSelect();
    const status =
        String(registrationStatusSelect?.value || "").trim() || "pending";
    const params =
        status && status !== "all"
            ? `?status=${encodeURIComponent(status)}&limit=200`
            : "?limit=200";
    const { response, data } = await api(
        `/api/v1/admin/registration-requests${params}`,
    );
    if (!response.ok || !data?.ok) {
        renderRegistrationRows([]);
        setRegistrationMessage(
            resolveErrorMessage(
                data,
                t(I18nKey.adminUsersLoadRegistrationsFailed),
            ),
        );
        return;
    }
    setRegistrationMessage("");
    renderRegistrationRows((data.items as UnknownRecord[]) || []);
};

const processRegistrationAction = async (
    requestId: string,
    action: "approve" | "reject",
    rejectReason: string,
): Promise<void> => {
    const payload: { action: "approve" | "reject"; reason?: string } = {
        action,
    };
    if (action !== "approve") {
        payload.reason = rejectReason;
    }

    setRegistrationMessage(t(I18nKey.interactionCommonProcessing));
    await runWithTask(
        {
            title: t(I18nKey.adminUsersProcessingRegistrationTitle),
            mode: "indeterminate",
            text: t(I18nKey.interactionCommonProcessing),
        },
        async ({ update }) => {
            const { response, data } = await api(
                `/api/v1/admin/registration-requests/${encodeURIComponent(requestId)}`,
                {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                },
            );
            if (!response.ok || !data?.ok) {
                setRegistrationMessage(
                    resolveErrorMessage(
                        data,
                        t(I18nKey.interactionCommonActionFailed),
                    ),
                );
                return;
            }
            update({
                text: t(I18nKey.interactionCommonActionSucceededReloading),
            });
            setRegistrationMessage(t(I18nKey.interactionCommonActionSucceeded));
            await loadRegistrationRequests();
            if (action === "approve") {
                await loadUsers();
            }
        },
    );
};

const showRegistrationDetailDialog = async (
    requestId: string,
): Promise<void> => {
    const item = registrationRequestMap.get(requestId);
    if (!item) {
        setRegistrationMessage(t(I18nKey.adminUsersRegistrationNotFound));
        return;
    }

    const { status, content } = buildRegistrationDetailContent(item);
    const canReview = status === "pending";

    const result = await showOverlayDialog({
        ariaLabel: t(I18nKey.adminUsersRegistrationDetail),
        message: t(I18nKey.adminUsersRegistrationDetail),
        dismissKey: "close",
        content,
        contentColumns: 2,
        fields: canReview
            ? [
                  {
                      name: "reason",
                      label: t(I18nKey.adminUsersRejectReasonOptional),
                      kind: "textarea",
                      required: false,
                      placeholder: t(I18nKey.adminUsersRejectReasonPlaceholder),
                      rows: 3,
                  },
              ]
            : [],
        actions: canReview
            ? [
                  {
                      key: "approve",
                      label: t(I18nKey.adminUsersApprove),
                      variant: "primary",
                  },
                  {
                      key: "reject",
                      label: t(I18nKey.adminUsersReject),
                      variant: "danger",
                  },
                  {
                      key: "close",
                      label: t(I18nKey.interactionCommonClose),
                      variant: "secondary",
                  },
              ]
            : [
                  {
                      key: "close",
                      label: t(I18nKey.interactionCommonClose),
                      variant: "secondary",
                  },
              ],
    });

    if (!canReview || result.actionKey === "close") {
        return;
    }

    const action = result.actionKey === "approve" ? "approve" : "reject";
    const rejectReason = String(result.values.reason || "").trim();
    await processRegistrationAction(requestId, action, rejectReason);
};

let pageEventsController: AbortController | null = null;

const handleDeleteUser = async (
    target: HTMLElement,
    userId: string,
): Promise<void> => {
    const username = String(target.getAttribute("data-username") || "").trim();
    const email = String(target.getAttribute("data-email") || "").trim();
    const expectedText = tFmt(I18nKey.adminUsersDeleteExpectedText, {
        name: email || username || userId,
    });
    const confirmDelete = await showConfirmDialog({
        message: t(I18nKey.adminUsersDeleteConfirmMessage),
        confirmText: t(I18nKey.adminUsersDeleteConfirmButton),
        confirmVariant: "danger",
        manualConfirm: {
            expectedText,
            placeholder: expectedText,
            mismatchMessage: t(I18nKey.interactionDialogManualConfirmMismatch),
        },
    });
    if (!confirmDelete) {
        return;
    }

    await runWithTask(
        {
            title: t(I18nKey.adminUsersDeleteAccount),
            mode: "indeterminate",
            text: t(I18nKey.interactionCommonProcessing),
        },
        async ({ update }) => {
            const { response, data } = await api(
                `/api/v1/admin/users/${userId}`,
                {
                    method: "DELETE",
                },
            );
            if (!response.ok || !data?.ok) {
                window.alert(
                    resolveErrorMessage(
                        data,
                        t(I18nKey.interactionCommonDeleteFailed),
                    ),
                );
                return;
            }
            update({
                text: t(I18nKey.interactionCommonActionSucceededReloading),
            });
            window.alert(t(I18nKey.adminUsersDeleted));
            await loadUsers();
        },
    );
};

const handleRegisterSwitchChange = async (): Promise<void> => {
    const currentRegisterEnabledInput = getRegisterEnabledInput();
    if (!currentRegisterEnabledInput) {
        return;
    }
    const previousChecked = !currentRegisterEnabledInput.checked;
    currentRegisterEnabledInput.disabled = true;
    setRegisterMessage(t(I18nKey.interactionCommonSaving));
    try {
        await runWithTask(
            {
                title: t(I18nKey.adminUsersSavingRegisterSwitchTitle),
                mode: "indeterminate",
                text: t(I18nKey.interactionCommonSaving),
            },
            async ({ update }) => {
                const { response, data } = await api(
                    "/api/v1/admin/settings/site",
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            auth: {
                                register_enabled: Boolean(
                                    currentRegisterEnabledInput.checked,
                                ),
                            },
                        }),
                    },
                );
                if (!response.ok || !data?.ok) {
                    currentRegisterEnabledInput.checked = previousChecked;
                    setRegisterMessage(
                        resolveErrorMessage(
                            data,
                            t(I18nKey.interactionCommonSaveFailed),
                        ),
                    );
                    return;
                }
                update({ text: t(I18nKey.interactionCommonSaveCompleted) });
                setRegisterMessage(t(I18nKey.interactionCommonSaveSuccess));
            },
        );
    } catch (error) {
        console.error("[admin-users] save register switch failed:", error);
        currentRegisterEnabledInput.checked = previousChecked;
        setRegisterMessage(t(I18nKey.interactionCommonSaveFailedRetry));
    } finally {
        currentRegisterEnabledInput.disabled = false;
    }
};

const bindEvents = (): void => {
    pageEventsController?.abort();
    pageEventsController = new AbortController();
    const { signal } = pageEventsController;

    document
        .getElementById("admin-users-refresh")
        ?.addEventListener("click", () => void loadUsers(), { signal });

    document
        .getElementById("admin-registration-refresh")
        ?.addEventListener("click", () => void loadRegistrationRequests(), {
            signal,
        });

    const registrationStatusSelect = getRegistrationStatusSelect();
    registrationStatusSelect?.addEventListener(
        "change",
        () => {
            void loadRegistrationRequests();
        },
        { signal },
    );

    const registerEnabledInput = getRegisterEnabledInput();
    registerEnabledInput?.addEventListener(
        "change",
        () => void handleRegisterSwitchChange(),
        { signal },
    );

    const usersTableBody = getUsersTableBody();
    usersTableBody?.addEventListener(
        "click",
        (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            if (!target) return;
            const action = target.getAttribute("data-action");
            const userId = target.getAttribute("data-user-id");
            if (!action || !userId) return;

            if (action === "delete") {
                void handleDeleteUser(target, userId);
            }
        },
        { signal },
    );

    const registrationTableBody = getRegistrationTableBody();
    registrationTableBody?.addEventListener(
        "click",
        async (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            if (!target) {
                return;
            }
            const actionTarget = target.closest<HTMLElement>(
                "[data-registration-action]",
            );
            if (!actionTarget) {
                return;
            }
            const action = String(
                actionTarget.getAttribute("data-registration-action") || "",
            );
            const requestId = String(
                actionTarget.getAttribute("data-registration-id") || "",
            ).trim();
            if (action !== "detail" || !requestId) {
                return;
            }
            await showRegistrationDetailDialog(requestId);
        },
        { signal },
    );
};

export const initAdminUsersPage = (): void => {
    if (!getUsersTableBody() || !getRegistrationTableBody()) {
        pageEventsController?.abort();
        return;
    }
    bindEvents();
    void Promise.all([
        loadUsers(),
        loadRegistrationRequests(),
        loadRegisterSwitch(),
    ]);
};
