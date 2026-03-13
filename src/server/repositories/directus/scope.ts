import type { DirectusRequestScope } from "@/server/directus/client";
import {
    runWithDirectusPublicAccess,
    runWithDirectusServiceAccess,
    runWithDirectusUserAccess,
} from "@/server/directus/client";

export type RepositoryContext = DirectusRequestScope;

/**
 * Repository 层统一声明 Directus 访问 scope，避免路由和应用层直接接触底层授权包装。
 */
export async function withPublicRepositoryContext<T>(
    task: () => Promise<T>,
): Promise<T> {
    return await runWithDirectusPublicAccess(task);
}

export async function withServiceRepositoryContext<T>(
    task: () => Promise<T>,
): Promise<T> {
    return await runWithDirectusServiceAccess(task);
}

export async function withUserRepositoryContext<T>(
    accessToken: string,
    task: () => Promise<T>,
): Promise<T> {
    return await runWithDirectusUserAccess(accessToken, task);
}
