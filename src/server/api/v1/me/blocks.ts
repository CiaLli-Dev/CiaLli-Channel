import type { APIContext } from "astro";

import * as z from "zod";
import type { JsonObject } from "@/types/json";
import { assertOwnerOrAdmin } from "@/server/auth/acl";
import {
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";

import type { AppAccess } from "../shared";
import { parseRouteId } from "../shared";

const CreateBlockSchema = z.object({
    blocked_user_id: z.string().min(1, "缺少被屏蔽用户 ID"),
    reason: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
});

export async function handleMeBlocks(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 1) {
        if (context.request.method === "GET") {
            const { page, limit, offset } = parsePagination(context.url);
            const rows = await readMany("app_user_blocks", {
                filter: {
                    _and: [
                        { blocker_id: { _eq: access.user.id } },
                        { status: { _eq: "published" } },
                    ],
                } as JsonObject,
                sort: ["-date_created"],
                limit,
                offset,
            });
            return ok({
                items: rows,
                page,
                limit,
                total: rows.length,
            });
        }

        if (context.request.method === "POST") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(CreateBlockSchema, body);
            if (input.blocked_user_id === access.user.id) {
                return fail("不能屏蔽自己", 400);
            }

            const existing = await readMany("app_user_blocks", {
                filter: {
                    _and: [
                        { blocker_id: { _eq: access.user.id } },
                        { blocked_user_id: { _eq: input.blocked_user_id } },
                        { status: { _eq: "published" } },
                    ],
                } as JsonObject,
                limit: 1,
            });
            if (existing.length > 0) {
                return ok({ item: existing[0], existed: true });
            }

            const created = await createOne("app_user_blocks", {
                status: "published",
                blocker_id: access.user.id,
                blocked_user_id: input.blocked_user_id,
                reason: input.reason ?? null,
                note: input.note ?? null,
            });
            return ok({ item: created, existed: false });
        }
    }

    if (segments.length === 2) {
        const blockId = parseRouteId(segments[1]);
        if (!blockId) {
            return fail("缺少屏蔽记录 ID", 400);
        }
        const block = await readOneById("app_user_blocks", blockId);
        if (!block) {
            return fail("屏蔽记录不存在", 404);
        }
        assertOwnerOrAdmin(access, block.blocker_id);

        if (context.request.method === "DELETE") {
            const updated = await updateOne("app_user_blocks", blockId, {
                status: "archived",
            });
            return ok({ item: updated });
        }
    }

    return fail("未找到接口", 404);
}
