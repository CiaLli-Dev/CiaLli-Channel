import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    readMany: vi.fn(),
}));

vi.mock("@/server/directus/client", () => ({
    readMany: mocks.readMany,
    deleteDirectusFile: vi.fn(),
}));

import { readStaleFileGcCandidatesFromRepository } from "@/server/repositories/files/file-cleanup.repository";

describe("file-cleanup.repository", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readMany.mockResolvedValue([]);
    });

    it("builds the GC candidate filter for aged ownerless or temporary-purpose files", async () => {
        await readStaleFileGcCandidatesFromRepository({
            createdBefore: "2026-04-23T00:00:00.000Z",
            temporaryPurposes: ["registration-avatar", "general"],
            limit: 200,
        });

        expect(mocks.readMany).toHaveBeenCalledWith("directus_files", {
            filter: {
                _and: [
                    { date_created: { _lte: "2026-04-23T00:00:00.000Z" } },
                    {
                        _or: [
                            { app_owner_user_id: { _null: true } },
                            {
                                app_upload_purpose: {
                                    _in: ["registration-avatar", "general"],
                                },
                            },
                        ],
                    },
                ],
            },
            fields: [
                "id",
                "date_created",
                "app_owner_user_id",
                "app_upload_purpose",
            ],
            sort: ["date_created", "id"],
            limit: 200,
        });
    });
});
