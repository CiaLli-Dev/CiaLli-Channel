import type { JsonObject } from "@/types/json";
import { readMany } from "@/server/directus/client";

type RegistrationRequestRecord = {
    id?: string;
    request_status?: unknown;
    approved_user_id?: unknown;
};

export async function findRegistrationRequestById(
    requestId: string,
): Promise<RegistrationRequestRecord | null> {
    const rows = await readMany("app_user_registration_requests", {
        filter: { id: { _eq: requestId } } as JsonObject,
        limit: 1,
        fields: ["id", "request_status", "approved_user_id"],
    });
    return (rows[0] as RegistrationRequestRecord | undefined) ?? null;
}
