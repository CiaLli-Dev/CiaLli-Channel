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

    it("builds the GC candidate filters for expired detached and temporary files", async () => {
        await readStaleFileGcCandidatesFromRepository({
            detachedBefore: "2026-04-23T00:00:00.000Z",
            limit: 200,
        });

        expect(mocks.readMany).toHaveBeenNthCalledWith(1, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "detached" } },
                    { app_detached_at: { _nnull: true } },
                    { app_detached_at: { _lte: "2026-04-23T00:00:00.000Z" } },
                ],
            },
            fields: ["id", "date_created", "app_lifecycle", "app_detached_at"],
            sort: ["app_detached_at", "id"],
            limit: 200,
        });
        expect(mocks.readMany).toHaveBeenNthCalledWith(2, "directus_files", {
            filter: {
                _and: [
                    { app_lifecycle: { _eq: "temporary" } },
                    { date_created: { _nnull: true } },
                    { date_created: { _lte: "2026-04-23T00:00:00.000Z" } },
                ],
            },
            fields: ["id", "date_created", "app_lifecycle", "app_detached_at"],
            sort: ["date_created", "id"],
            limit: 200,
        });
    });
});
