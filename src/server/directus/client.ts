/* eslint-disable max-lines -- Directus 客户端集中维护 service/public/user 三类访问模型 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
    aggregate,
    createDirectus,
    createItem,
    createUser,
    customEndpoint,
    deleteFile,
    deleteItem,
    readItem,
    readItems,
    readFiles,
    readUser,
    readUsers,
    rest,
    staticToken,
    updateItem,
    updateFile,
    updateUser,
    uploadFiles,
    withToken,
} from "@directus/sdk";

import type { AppUser } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { internal } from "@/server/api/errors";
import { getDirectusUrl } from "@/server/directus-auth";
import {
    isDirectusItemNotFound,
    toDirectusError,
} from "@/server/directus/client-errors";

import type { DirectusSchema } from "./schema";

type DirectusQuery = {
    filter?: JsonObject;
    sort?: string[];
    limit?: number;
    offset?: number;
    fields?: string[];
    search?: string;
    deep?: JsonObject;
};

type DirectusAssetQuery = Partial<
    Record<"width" | "height" | "fit" | "quality" | "format", string>
>;

type DirectusAggregateRow = Record<string, unknown>;

type DirectusRequestScope =
    | { kind: "service" }
    | { kind: "public" }
    | { kind: "user"; accessToken: string };

type DirectusPolicyRecord = {
    id: string;
    name: string;
    description?: string | null;
    admin_access?: boolean;
    app_access?: boolean;
};

type DirectusRoleRecord = {
    id: string;
    name: string;
    description?: string | null;
};

type DirectusUserPolicyAssignment = {
    id: string;
    policy: string;
};

const SAFE_DIARY_FIELDS = [
    "id",
    "short_id",
    "author_id",
    "status",
    "content",
    "allow_comments",
    "praviate",
    "date_created",
    "date_updated",
] as const;

const DATA_FETCH_TIMEOUT_MS = 30_000;

const directusScopeStorage = new AsyncLocalStorage<DirectusRequestScope>();

function getStaticToken(): string {
    const token =
        process.env.DIRECTUS_STATIC_TOKEN ||
        import.meta.env.DIRECTUS_STATIC_TOKEN;
    if (!token || !token.trim()) {
        throw internal("DIRECTUS_STATIC_TOKEN 未配置");
    }
    return token.trim();
}

function buildRestClient() {
    return createDirectus<DirectusSchema>(getDirectusUrl()).with(
        rest({
            onRequest: (options) => ({
                ...options,
                signal: AbortSignal.timeout(DATA_FETCH_TIMEOUT_MS),
            }),
        }),
    );
}

function buildServiceClient() {
    return createDirectus<DirectusSchema>(getDirectusUrl())
        .with(staticToken(getStaticToken()))
        .with(
            rest({
                onRequest: (options) => ({
                    ...options,
                    signal: AbortSignal.timeout(DATA_FETCH_TIMEOUT_MS),
                }),
            }),
        );
}

let restClientSingleton: ReturnType<typeof buildRestClient> | null = null;
let serviceClientSingleton: ReturnType<typeof buildServiceClient> | null = null;

function getRestClient() {
    if (restClientSingleton) {
        return restClientSingleton;
    }
    restClientSingleton = buildRestClient();
    console.info("[directus/client] 公共客户端初始化");
    return restClientSingleton;
}

function getServiceClient() {
    if (serviceClientSingleton) {
        return serviceClientSingleton;
    }
    serviceClientSingleton = buildServiceClient();
    console.info("[directus/client] 服务端客户端初始化");
    return serviceClientSingleton;
}

function getCurrentScope(): DirectusRequestScope {
    return directusScopeStorage.getStore() ?? { kind: "service" };
}

function getDirectusTargetHost(): string | undefined {
    try {
        return new URL(getDirectusUrl()).host;
    } catch {
        return undefined;
    }
}

export async function runWithDirectusPublicAccess<T>(
    task: () => Promise<T>,
): Promise<T> {
    return await directusScopeStorage.run({ kind: "public" }, task);
}

export async function runWithDirectusServiceAccess<T>(
    task: () => Promise<T>,
): Promise<T> {
    return await directusScopeStorage.run({ kind: "service" }, task);
}

export async function runWithDirectusUserAccess<T>(
    accessToken: string,
    task: () => Promise<T>,
): Promise<T> {
    const normalizedToken = String(accessToken || "").trim();
    if (!normalizedToken) {
        throw internal("缺少 Directus Access Token");
    }
    return await directusScopeStorage.run(
        { kind: "user", accessToken: normalizedToken },
        task,
    );
}

async function executeDirectusRequest<T>(
    action: string,
    request: unknown,
): Promise<T> {
    const scope = getCurrentScope();
    try {
        if (scope.kind === "service") {
            return await getServiceClient().request(request as never);
        }
        if (scope.kind === "public") {
            return await getRestClient().request(request as never);
        }
        return await getRestClient().request(
            withToken(scope.accessToken, request as never),
        );
    } catch (error) {
        throw toDirectusError(action, error, {
            scope: scope.kind,
            targetHost: getDirectusTargetHost(),
            timeoutMs: DATA_FETCH_TIMEOUT_MS,
        });
    }
}

function parseAggregateCountValue(input: unknown): number {
    if (typeof input === "number" && Number.isFinite(input)) {
        return input;
    }
    const parsed = parseInt(String(input ?? "0"), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function assertNonSystemCollection(collection: keyof DirectusSchema): void {
    if (collection === "directus_users" || collection === "directus_files") {
        throw internal(
            `请勿使用通用 items 接口写入系统集合: ${String(collection)}`,
        );
    }
}

function parseItemArrayResponse<T>(input: unknown): T[] {
    if (Array.isArray(input)) {
        return input as T[];
    }
    if (
        input &&
        typeof input === "object" &&
        Array.isArray((input as { data?: unknown[] }).data)
    ) {
        return ((input as { data: unknown[] }).data ?? []) as T[];
    }
    return [];
}

export async function readMany<K extends keyof DirectusSchema>(
    collection: K,
    query?: DirectusQuery,
): Promise<DirectusSchema[K]> {
    if (collection === "directus_users") {
        return (await executeDirectusRequest(
            "读取用户列表",
            readUsers(query as never),
        )) as DirectusSchema[K];
    }
    if (collection === "directus_files") {
        return (await executeDirectusRequest(
            "读取文件列表",
            readFiles(query as never),
        )) as DirectusSchema[K];
    }

    return (await executeDirectusRequest(
        `读取集合 ${String(collection)} 列表`,
        readItems(collection as never, query as never),
    )) as DirectusSchema[K];
}

export async function readOneById<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    query?: { fields?: string[]; deep?: JsonObject },
): Promise<DirectusSchema[K][number] | null> {
    try {
        if (collection === "directus_users") {
            const user = await executeDirectusRequest(
                "读取用户明细",
                readUser(id, {
                    fields: query?.fields,
                } as never),
            );
            return user as DirectusSchema[K][number];
        }

        const item = await executeDirectusRequest(
            `读取集合 ${String(collection)} 明细`,
            readItem(collection as never, id, {
                fields: query?.fields,
                deep: query?.deep,
            } as never),
        );
        return item as DirectusSchema[K][number];
    } catch (error) {
        if (isDirectusItemNotFound(error)) {
            return null;
        }
        throw toDirectusError(`读取集合 ${String(collection)} 明细`, error);
    }
}

export async function countItems<K extends keyof DirectusSchema>(
    collection: K,
    filter?: JsonObject,
): Promise<number> {
    const result = await executeDirectusRequest(
        `统计集合 ${String(collection)} 总数`,
        aggregate(
            collection as never,
            {
                aggregate: { count: "*" },
                query: filter ? { filter } : {},
            } as never,
        ),
    );
    const row = Array.isArray(result) ? result[0] : result;
    const count = (row as DirectusAggregateRow)?.count;
    return parseAggregateCountValue(count);
}

export async function countItemsGroupedByField<K extends keyof DirectusSchema>(
    collection: K,
    groupField: string,
    filter?: JsonObject,
): Promise<Map<string, number>> {
    const result = await executeDirectusRequest(
        `按 ${groupField} 聚合统计集合 ${String(collection)} 总数`,
        aggregate(
            collection as never,
            {
                aggregate: { count: "*" },
                groupBy: [groupField],
                query: filter ? { filter } : {},
            } as never,
        ),
    );

    const rows = Array.isArray(result) ? result : [result];
    const counter = new Map<string, number>();
    for (const row of rows) {
        const record = row as DirectusAggregateRow;
        const groupValue = String(record[groupField] ?? "").trim();
        if (!groupValue) {
            continue;
        }
        const count = parseAggregateCountValue(record.count);
        if (count > 0) {
            counter.set(groupValue, count);
        }
    }
    return counter;
}

export async function createOne<K extends keyof DirectusSchema>(
    collection: K,
    payload: Partial<DirectusSchema[K][number]>,
    query?: { fields?: string[] },
): Promise<DirectusSchema[K][number]> {
    assertNonSystemCollection(collection);
    return (await executeDirectusRequest(
        `创建集合 ${String(collection)} 数据`,
        createItem(
            collection as never,
            payload as never,
            {
                fields: query?.fields,
            } as never,
        ),
    )) as DirectusSchema[K][number];
}

export async function updateOne<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    payload: Partial<DirectusSchema[K][number]>,
    query?: { fields?: string[] },
): Promise<DirectusSchema[K][number]> {
    assertNonSystemCollection(collection);
    const resolvedFields =
        query?.fields && query.fields.length > 0
            ? query.fields
            : collection === "app_diaries"
              ? [...SAFE_DIARY_FIELDS]
              : undefined;

    return (await executeDirectusRequest(
        `更新集合 ${String(collection)} 数据`,
        updateItem(
            collection as never,
            id,
            payload as never,
            {
                fields: resolvedFields,
            } as never,
        ),
    )) as DirectusSchema[K][number];
}

export async function updateOneWithoutReadback<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
    payload: Partial<DirectusSchema[K][number]>,
): Promise<void> {
    assertNonSystemCollection(collection);
    await executeDirectusRequest(
        `更新集合 ${String(collection)} 数据`,
        updateItem(
            collection as never,
            id,
            payload as never,
            {
                fields: ["id"],
            } as never,
        ),
    );
}

export async function deleteOne<K extends keyof DirectusSchema>(
    collection: K,
    id: string,
): Promise<void> {
    assertNonSystemCollection(collection);
    await executeDirectusRequest(
        `删除集合 ${String(collection)} 数据`,
        deleteItem(collection as never, id),
    );
}

export async function createDirectusUser(payload: {
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
    status?: string;
    role?: string;
    policies?: string[];
}): Promise<{ id: string }> {
    const created = await executeDirectusRequest(
        "创建 Directus 用户",
        createUser(
            payload as never,
            {
                fields: ["id"],
            } as never,
        ),
    );

    const id =
        typeof (created as { id?: unknown }).id === "string"
            ? ((created as { id: string }).id ?? "")
            : String((created as { id?: unknown }).id ?? "");
    if (!id) {
        throw internal("创建用户成功但未返回 id");
    }
    return { id };
}

export async function updateDirectusUser(
    id: string,
    payload: JsonObject,
): Promise<{ id: string }> {
    const updated = await executeDirectusRequest(
        "更新 Directus 用户",
        updateUser(
            id,
            payload as never,
            {
                fields: ["id"],
            } as never,
        ),
    );

    const userId =
        typeof (updated as { id?: unknown }).id === "string"
            ? ((updated as { id: string }).id ?? "")
            : String((updated as { id?: unknown }).id ?? "");
    if (!userId) {
        throw internal("更新用户成功但未返回 id");
    }
    return { id: userId };
}

export async function syncDirectusUserPolicies(params: {
    userId: string;
    currentAssignments: DirectusUserPolicyAssignment[];
    desiredPolicyIds: string[];
}): Promise<void> {
    const desiredSet = new Set(
        params.desiredPolicyIds
            .map((policyId) => String(policyId || "").trim())
            .filter(Boolean),
    );
    const currentAssignments = params.currentAssignments
        .map((assignment) => ({
            id: String(assignment.id || "").trim(),
            policy: String(assignment.policy || "").trim(),
        }))
        .filter((assignment) => assignment.id && assignment.policy);

    const create = Array.from(desiredSet)
        .filter(
            (policyId) =>
                !currentAssignments.some(
                    (assignment) => assignment.policy === policyId,
                ),
        )
        .map((policyId) => ({ policy: policyId }));
    const deleteIds = currentAssignments
        .filter((assignment) => !desiredSet.has(assignment.policy))
        .map((assignment) => assignment.id);

    if (create.length === 0 && deleteIds.length === 0) {
        return;
    }

    await executeDirectusRequest(
        "同步 Directus 用户策略",
        updateUser(
            params.userId,
            {
                policies: {
                    create,
                    delete: deleteIds,
                },
            } as never,
            {
                fields: ["id"],
            } as never,
        ),
    );
}

export async function deleteDirectusUser(id: string): Promise<void> {
    await executeDirectusRequest(
        "删除 Directus 用户",
        customEndpoint({
            path: `/users/${encodeURIComponent(id)}`,
            method: "DELETE",
        }),
    );
}

export async function listDirectusUsers(params?: {
    limit?: number;
    offset?: number;
    search?: string;
}): Promise<AppUser[]> {
    return (await executeDirectusRequest(
        "读取 Directus 用户列表",
        readUsers({
            fields: [
                "id",
                "email",
                "first_name",
                "last_name",
                "description",
                "avatar",
                "status",
                "role.id",
                "role.name",
                "policies.*",
            ],
            limit: params?.limit ?? 50,
            offset: params?.offset ?? 0,
            search: params?.search,
        } as never),
    )) as AppUser[];
}

export async function listDirectusRoles(): Promise<DirectusRoleRecord[]> {
    const response = await executeDirectusRequest(
        "读取 Directus 角色列表",
        customEndpoint({
            path: "/roles",
            method: "GET",
            params: {
                limit: 100,
                fields: ["id", "name", "description"],
                sort: ["name"],
            },
        }),
    );
    return parseItemArrayResponse<DirectusRoleRecord>(response);
}

export async function listDirectusPolicies(): Promise<DirectusPolicyRecord[]> {
    const response = await executeDirectusRequest(
        "读取 Directus 策略列表",
        customEndpoint({
            path: "/policies",
            method: "GET",
            params: {
                limit: 200,
                fields: [
                    "id",
                    "name",
                    "description",
                    "admin_access",
                    "app_access",
                ],
                sort: ["name"],
            },
        }),
    );
    return parseItemArrayResponse<DirectusPolicyRecord>(response);
}

export async function uploadDirectusFile(params: {
    file: File;
    title?: string;
    folder?: string;
}): Promise<{ id: string; title?: string; filename_download?: string }> {
    const form = new FormData();
    form.append("file", params.file, params.file.name);
    if (params.title) {
        form.append("title", params.title);
    }
    if (params.folder) {
        form.append("folder", params.folder);
    }

    const uploaded = await executeDirectusRequest(
        "上传 Directus 文件",
        uploadFiles(form, {
            fields: ["id", "title", "filename_download"],
        } as never),
    );

    const data = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    const id =
        typeof (data as { id?: unknown }).id === "string"
            ? ((data as { id: string }).id ?? "")
            : String((data as { id?: unknown }).id ?? "");
    if (!id) {
        throw internal("文件上传成功但响应中缺少 id");
    }

    return {
        id,
        title:
            typeof (data as { title?: unknown }).title === "string"
                ? ((data as { title?: string }).title ?? undefined)
                : undefined,
        filename_download:
            typeof (data as { filename_download?: unknown })
                .filename_download === "string"
                ? ((data as { filename_download?: string }).filename_download ??
                  undefined)
                : undefined,
    };
}

export async function updateDirectusFileMetadata(
    id: string,
    payload: {
        title?: string | null;
        description?: string | null;
        filename_download?: string | null;
        folder?: string | null;
        uploaded_by?: string | null;
        modified_by?: string | null;
        app_owner_user_id?: string | null;
        app_visibility?: "private" | "public" | null;
    },
): Promise<void> {
    await executeDirectusRequest(
        "更新 Directus 文件元数据",
        updateFile(id, payload as never),
    );
}

export async function updateManyItemsByFilter(params: {
    collection: string;
    filter: JsonObject;
    data: JsonObject;
}): Promise<void> {
    const rows = await executeDirectusRequest(
        `读取集合 ${params.collection} 批量更新候选`,
        customEndpoint({
            path: `/items/${encodeURIComponent(params.collection)}`,
            method: "GET",
            params: {
                filter: params.filter,
                fields: ["id"],
                limit: 5000,
            },
        }),
    );

    const keys = parseItemArrayResponse<Record<string, unknown>>(rows)
        .map((item) => String(item.id ?? "").trim())
        .filter(Boolean);
    if (keys.length === 0) {
        return;
    }

    await executeDirectusRequest(
        `批量更新集合 ${params.collection} 数据`,
        customEndpoint({
            path: `/items/${encodeURIComponent(params.collection)}`,
            method: "PATCH",
            body: {
                keys,
                data: params.data,
            } as never,
        }),
    );
}

export async function deleteDirectusFile(fileId: string): Promise<void> {
    if (!fileId) {
        return;
    }
    try {
        await executeDirectusRequest("删除 Directus 文件", deleteFile(fileId));
    } catch (error) {
        console.warn(
            "[directus/client] 删除文件失败，可能已不存在:",
            fileId,
            error,
        );
    }
}

export async function readDirectusAssetResponse(params: {
    fileId: string;
    query?: DirectusAssetQuery;
}): Promise<Response> {
    const result = await executeDirectusRequest(
        "读取 Directus 资源",
        customEndpoint<Response>({
            path: `/assets/${encodeURIComponent(params.fileId)}`,
            method: "GET",
            params: params.query,
            headers: {
                Accept: "*/*",
            },
        }),
    );

    if (result instanceof Response) {
        return result;
    }
    throw internal("资源响应格式无效");
}

export type { DirectusPolicyRecord, DirectusRoleRecord, DirectusRequestScope };
