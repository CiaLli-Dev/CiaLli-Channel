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

type AdminUsersSortBy = "email" | "username" | "role";
type AdminUsersSortOrder = "asc" | "desc";

type UsersSortButtonState = {
    button: HTMLButtonElement;
    label: string;
};

type UsersDialogSession = {
    container: HTMLElement;
    tableBody: HTMLTableSectionElement;
    messageEl: HTMLElement;
    sortButtons: Map<AdminUsersSortBy, UsersSortButtonState>;
    sortBy: AdminUsersSortBy;
    sortOrder: AdminUsersSortOrder;
    sourceRows: UnknownRecord[];
    requestVersion: number;
    closed: boolean;
    eventsController: AbortController;
};

const USERS_DIALOG_LIMIT = 200;
const USER_SORT_COLUMNS = ["email", "username", "role"] as const;

const getUsersListOpenButton = (): HTMLButtonElement | null =>
    document.getElementById(
        "admin-users-open-list",
    ) as HTMLButtonElement | null;
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
let registrationRequestsCache: UnknownRecord[] = [];

const renderRegistrationRows = (rows: UnknownRecord[]): void => {
    renderRegistrationRowsImpl(
        rows,
        getRegistrationTableBody,
        registrationRequestMap,
    );
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

function filterRegistrationRequestsByStatus(
    rows: UnknownRecord[],
    status: string,
): UnknownRecord[] {
    if (status === "all") {
        return [...rows];
    }
    return rows.filter((item) => {
        const requestStatus = String(item.request_status || "").trim();
        return requestStatus === status;
    });
}

const loadRegistrationRequests = async (options?: {
    forceReload?: boolean;
}): Promise<void> => {
    const registrationStatusSelect = getRegistrationStatusSelect();
    const status =
        String(registrationStatusSelect?.value || "").trim() || "pending";

    // 分类切换仅做本地筛选；只有首次加载、手动刷新或审批后才重拉接口。
    if (options?.forceReload || registrationRequestsCache.length === 0) {
        const { response, data } = await api(
            "/api/v1/admin/registration-requests?limit=200",
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
        registrationRequestsCache = Array.isArray(data.items)
            ? (data.items as UnknownRecord[])
            : [];
    }

    setRegistrationMessage("");
    renderRegistrationRows(
        filterRegistrationRequestsByStatus(registrationRequestsCache, status),
    );
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
            await loadRegistrationRequests({
                forceReload: true,
            });
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
        cardClassName: "settings-console-dialog-card",
        bodyClassName: "settings-console-dialog-body",
        actionsClassName: "settings-console-dialog-actions",
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

function isUserSortBy(value: string): value is AdminUsersSortBy {
    return (USER_SORT_COLUMNS as readonly string[]).includes(value);
}

function renderUsersPlaceholderRow(
    tableBody: HTMLTableSectionElement,
    message: string,
): void {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "py-4 text-60";
    cell.textContent = message;
    row.appendChild(cell);
    tableBody.replaceChildren(row);
}

function createUsersSortButton(
    label: string,
    sortBy: AdminUsersSortBy,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlay-dialog-sort-btn";
    button.setAttribute("data-users-sort-by", sortBy);
    button.setAttribute("aria-sort", "none");
    button.setAttribute("aria-label", label);

    const textEl = document.createElement("span");
    textEl.textContent = label;

    const indicatorEl = document.createElement("span");
    indicatorEl.className = "overlay-dialog-sort-indicator";
    indicatorEl.setAttribute("data-users-sort-indicator", sortBy);
    indicatorEl.textContent = "↕";

    button.appendChild(textEl);
    button.appendChild(indicatorEl);
    return button;
}

function updateUsersSortButtons(session: UsersDialogSession): void {
    for (const [sortBy, sortButtonState] of session.sortButtons.entries()) {
        const isActive = sortBy === session.sortBy;
        const direction =
            session.sortOrder === "asc" ? "ascending" : "descending";
        sortButtonState.button.setAttribute(
            "aria-sort",
            isActive ? direction : "none",
        );
        sortButtonState.button.setAttribute(
            "aria-label",
            isActive
                ? `${sortButtonState.label} (${t(
                      session.sortOrder === "asc"
                          ? I18nKey.adminUsersSortAsc
                          : I18nKey.adminUsersSortDesc,
                  )})`
                : sortButtonState.label,
        );
        const indicatorEl = sortButtonState.button.querySelector<HTMLElement>(
            "[data-users-sort-indicator]",
        );
        if (!indicatorEl) {
            continue;
        }
        indicatorEl.textContent = isActive
            ? session.sortOrder === "asc"
                ? "↑"
                : "↓"
            : "↕";
    }
}

function createUsersDialogSession(): UsersDialogSession {
    const container = document.createElement("section");
    container.className =
        "overlay-dialog-table-shell settings-console-table-shell";

    const tableScroll = document.createElement("div");
    tableScroll.className = "overlay-dialog-table-scroll";

    const table = document.createElement("table");
    table.className = "overlay-dialog-table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

    const sortButtons = new Map<AdminUsersSortBy, UsersSortButtonState>();
    const emailLabel = t(I18nKey.authEmailLabel);
    const usernameLabel = t(I18nKey.meSettingsUsernameLabel);
    const roleLabel = t(I18nKey.adminUsersRole);
    const emailSortButton = createUsersSortButton(emailLabel, "email");
    const usernameSortButton = createUsersSortButton(usernameLabel, "username");
    const roleSortButton = createUsersSortButton(roleLabel, "role");

    sortButtons.set("email", {
        button: emailSortButton,
        label: emailLabel,
    });
    sortButtons.set("username", {
        button: usernameSortButton,
        label: usernameLabel,
    });
    sortButtons.set("role", {
        button: roleSortButton,
        label: roleLabel,
    });

    const emailHeadCell = document.createElement("th");
    const usernameHeadCell = document.createElement("th");
    const roleHeadCell = document.createElement("th");
    const actionsHeadCell = document.createElement("th");
    actionsHeadCell.textContent = t(I18nKey.adminUsersActions);
    actionsHeadCell.style.width = "9.5rem";

    emailHeadCell.appendChild(emailSortButton);
    usernameHeadCell.appendChild(usernameSortButton);
    roleHeadCell.appendChild(roleSortButton);
    headRow.appendChild(emailHeadCell);
    headRow.appendChild(usernameHeadCell);
    headRow.appendChild(roleHeadCell);
    headRow.appendChild(actionsHeadCell);
    head.appendChild(headRow);

    const tableBody = document.createElement("tbody");
    table.appendChild(head);
    table.appendChild(tableBody);
    tableScroll.appendChild(table);

    const messageEl = document.createElement("p");
    messageEl.className = "overlay-dialog-table-message";

    container.appendChild(tableScroll);
    container.appendChild(messageEl);

    return {
        container,
        tableBody,
        messageEl,
        sortButtons,
        sortBy: "email",
        sortOrder: "asc",
        sourceRows: [],
        requestVersion: 0,
        closed: false,
        eventsController: new AbortController(),
    };
}

function buildUsersListRequestPath(): string {
    const params = new URLSearchParams();
    params.set("limit", String(USERS_DIALOG_LIMIT));
    return `/api/v1/admin/users?${params.toString()}`;
}

function normalizeSortText(value: unknown): string {
    return String(value || "")
        .trim()
        .toLocaleLowerCase();
}

function resolveUserSortRoleRank(row: UnknownRecord): number {
    const isPlatformAdmin = Boolean(row.is_platform_admin);
    if (isPlatformAdmin) {
        return 0;
    }
    const permissions =
        typeof row.permissions === "object" && row.permissions
            ? (row.permissions as UnknownRecord)
            : null;
    const appRole = String(permissions?.app_role || "").trim();
    if (appRole === "admin" || Boolean(row.is_site_admin)) {
        return 1;
    }
    return 2;
}

type UsersSortSnapshot = {
    email: string;
    username: string;
    roleRank: number;
};

type IndexedUsersSortRow = {
    item: UnknownRecord;
    index: number;
    snapshot: UsersSortSnapshot;
};

function compareUsersSortTextAsc(
    leftValue: string,
    rightValue: string,
): number {
    return leftValue.localeCompare(rightValue);
}

function applyUsersSortOrder(
    diff: number,
    sortOrder: AdminUsersSortOrder,
): number {
    return sortOrder === "desc" ? -diff : diff;
}

function buildUsersSortSnapshot(row: UnknownRecord): UsersSortSnapshot {
    const user =
        typeof row.user === "object" && row.user
            ? (row.user as UnknownRecord)
            : null;
    const profile =
        typeof row.profile === "object" && row.profile
            ? (row.profile as UnknownRecord)
            : null;
    return {
        email: normalizeSortText(user?.email),
        username: normalizeSortText(profile?.username),
        roleRank: resolveUserSortRoleRank(row),
    };
}

function compareRoleSortedUsersRows(
    left: IndexedUsersSortRow,
    right: IndexedUsersSortRow,
    sortOrder: AdminUsersSortOrder,
): number {
    const rankDiff = left.snapshot.roleRank - right.snapshot.roleRank;
    if (rankDiff !== 0) {
        return applyUsersSortOrder(rankDiff, sortOrder);
    }

    const usernameDiff = compareUsersSortTextAsc(
        left.snapshot.username,
        right.snapshot.username,
    );
    if (usernameDiff !== 0) {
        return usernameDiff;
    }

    const emailDiff = compareUsersSortTextAsc(
        left.snapshot.email,
        right.snapshot.email,
    );
    if (emailDiff !== 0) {
        return emailDiff;
    }

    return left.index - right.index;
}

function compareTextSortedUsersRows(
    left: IndexedUsersSortRow,
    right: IndexedUsersSortRow,
    sortBy: Exclude<AdminUsersSortBy, "role">,
    sortOrder: AdminUsersSortOrder,
): number {
    const leftValue =
        sortBy === "email" ? left.snapshot.email : left.snapshot.username;
    const rightValue =
        sortBy === "email" ? right.snapshot.email : right.snapshot.username;

    const leftMissing = leftValue.length === 0;
    const rightMissing = rightValue.length === 0;
    if (leftMissing && rightMissing) {
        return left.index - right.index;
    }
    if (leftMissing) {
        return 1;
    }
    if (rightMissing) {
        return -1;
    }

    const primaryDiff = compareUsersSortTextAsc(leftValue, rightValue);
    if (primaryDiff !== 0) {
        return applyUsersSortOrder(primaryDiff, sortOrder);
    }

    const emailDiff = compareUsersSortTextAsc(
        left.snapshot.email,
        right.snapshot.email,
    );
    if (emailDiff !== 0) {
        return emailDiff;
    }

    return left.index - right.index;
}

function compareUsersRowsBySort(
    left: IndexedUsersSortRow,
    right: IndexedUsersSortRow,
    sortBy: AdminUsersSortBy,
    sortOrder: AdminUsersSortOrder,
): number {
    if (sortBy === "role") {
        return compareRoleSortedUsersRows(left, right, sortOrder);
    }
    return compareTextSortedUsersRows(left, right, sortBy, sortOrder);
}

function sortUsersRows(
    rows: UnknownRecord[],
    sortBy: AdminUsersSortBy,
    sortOrder: AdminUsersSortOrder,
): UnknownRecord[] {
    const indexedRows: IndexedUsersSortRow[] = rows.map((item, index) => ({
        item,
        index,
        snapshot: buildUsersSortSnapshot(item),
    }));

    indexedRows.sort((left, right) =>
        compareUsersRowsBySort(left, right, sortBy, sortOrder),
    );

    return indexedRows.map((entry) => entry.item);
}

function renderUsersBySessionSort(session: UsersDialogSession): void {
    renderUsersRowsImpl(
        sortUsersRows(session.sourceRows, session.sortBy, session.sortOrder),
        () => session.tableBody,
    );
}

async function loadUsersForDialog(
    session: UsersDialogSession,
    options: {
        showLoading: boolean;
        forceReload: boolean;
    },
): Promise<void> {
    if (!options.forceReload && session.sourceRows.length > 0) {
        renderUsersBySessionSort(session);
        session.messageEl.textContent = "";
        return;
    }

    const requestVersion = ++session.requestVersion;
    if (options.showLoading) {
        renderUsersPlaceholderRow(
            session.tableBody,
            t(I18nKey.interactionCommonLoading),
        );
    }

    const { response, data } = await api(buildUsersListRequestPath());
    if (session.closed || requestVersion !== session.requestVersion) {
        return;
    }

    if (!response.ok || !data?.ok) {
        renderUsersRowsImpl([], () => session.tableBody);
        session.messageEl.textContent = resolveErrorMessage(
            data,
            t(I18nKey.adminUsersLoadUsersFailed),
        );
        return;
    }

    session.sourceRows = Array.isArray(data.items)
        ? (data.items as UnknownRecord[])
        : [];
    renderUsersBySessionSort(session);
    session.messageEl.textContent = "";
}

function toggleUsersSortAndRender(
    session: UsersDialogSession,
    nextSortBy: AdminUsersSortBy,
): void {
    // 点击同一列在升序/降序之间切换；切换列时回到升序，保证行为可预期。
    if (session.sortBy === nextSortBy) {
        session.sortOrder = session.sortOrder === "asc" ? "desc" : "asc";
    } else {
        session.sortBy = nextSortBy;
        session.sortOrder = "asc";
    }
    updateUsersSortButtons(session);
    renderUsersBySessionSort(session);
}

let pageEventsController: AbortController | null = null;
let usersListDialogPromise: Promise<void> | null = null;

const handleDeleteUser = async (
    target: HTMLElement,
    userId: string,
    onDeleted: () => Promise<void>,
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
        cardClassName: "settings-console-dialog-card",
        bodyClassName: "settings-console-dialog-body",
        actionsClassName: "settings-console-dialog-actions",
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
            await onDeleted();
        },
    );
};

async function openUsersListDialog(): Promise<void> {
    if (usersListDialogPromise) {
        return usersListDialogPromise;
    }

    const session = createUsersDialogSession();
    updateUsersSortButtons(session);

    // 弹层内容节点与事件监听都绑定在 session 上，关闭后统一 abort + remove，避免悬空监听器。
    const usersTableHead = session.container.querySelector("thead");
    usersTableHead?.addEventListener(
        "click",
        (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            const sortTarget = target?.closest<HTMLButtonElement>(
                "[data-users-sort-by]",
            );
            if (!sortTarget) {
                return;
            }
            const nextSortBy = String(
                sortTarget.getAttribute("data-users-sort-by") || "",
            );
            if (!isUserSortBy(nextSortBy)) {
                return;
            }
            // 排序切换仅做本地重排，避免每次点击都触发数据库查询。
            toggleUsersSortAndRender(session, nextSortBy);
        },
        { signal: session.eventsController.signal },
    );

    session.tableBody.addEventListener(
        "click",
        (event) => {
            const target =
                event.target instanceof HTMLElement ? event.target : null;
            const actionTarget = target?.closest<HTMLElement>(
                "[data-action][data-user-id]",
            );
            if (!actionTarget) {
                return;
            }
            const action = String(
                actionTarget.getAttribute("data-action") || "",
            );
            const userId = String(
                actionTarget.getAttribute("data-user-id") || "",
            ).trim();
            if (action !== "delete" || !userId) {
                return;
            }
            void handleDeleteUser(actionTarget, userId, async () => {
                await loadUsersForDialog(session, {
                    showLoading: false,
                    forceReload: true,
                });
            });
        },
        { signal: session.eventsController.signal },
    );

    usersListDialogPromise = (async () => {
        const dialogPromise = showOverlayDialog({
            ariaLabel: t(I18nKey.adminUsersListTitle),
            message: t(I18nKey.adminUsersListTitle),
            dismissKey: "close",
            customContent: {
                node: session.container,
                className: "overlay-dialog-custom-content-data-table",
            },
            cardClassName:
                "overlay-dialog-card-data-table settings-console-dialog-card settings-console-dialog-card-data-table",
            bodyClassName:
                "overlay-dialog-body-data-table settings-console-dialog-body",
            actionsClassName: "settings-console-dialog-actions",
            actions: [
                {
                    key: "close",
                    label: t(I18nKey.interactionCommonClose),
                    variant: "secondary",
                },
            ],
        });
        await loadUsersForDialog(session, {
            showLoading: true,
            forceReload: true,
        });
        try {
            await dialogPromise;
        } finally {
            session.closed = true;
            session.eventsController.abort();
            session.container.remove();
        }
    })()
        .catch((error) => {
            console.error(
                "[admin-users] open users list dialog failed:",
                error,
            );
        })
        .finally(() => {
            usersListDialogPromise = null;
        });

    return usersListDialogPromise;
}

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
        .getElementById("admin-users-open-list")
        ?.addEventListener("click", () => void openUsersListDialog(), {
            signal,
        });

    document.getElementById("admin-registration-refresh")?.addEventListener(
        "click",
        () =>
            void loadRegistrationRequests({
                forceReload: true,
            }),
        {
            signal,
        },
    );

    const registrationStatusSelect = getRegistrationStatusSelect();
    registrationStatusSelect?.addEventListener(
        "change",
        () => {
            void loadRegistrationRequests({
                forceReload: false,
            });
        },
        { signal },
    );

    const registerEnabledInput = getRegisterEnabledInput();
    registerEnabledInput?.addEventListener(
        "change",
        () => void handleRegisterSwitchChange(),
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
    if (!getUsersListOpenButton() || !getRegistrationTableBody()) {
        pageEventsController?.abort();
        return;
    }
    registrationRequestsCache = [];
    bindEvents();
    void Promise.all([
        loadRegistrationRequests({
            forceReload: true,
        }),
        loadRegisterSwitch(),
    ]);
};
