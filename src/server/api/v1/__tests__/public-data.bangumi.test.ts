import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProfile } from "@/__tests__/helpers/mock-data";

vi.mock("@/server/directus/client", () => ({
    readMany: vi.fn(),
    countItems: vi.fn(),
    runWithDirectusServiceAccess: vi.fn(
        async (task: () => Promise<unknown>) => await task(),
    ),
}));

vi.mock("@/server/api/v1/shared/author-cache", () => ({
    getAuthorBundle: vi.fn(),
}));

vi.mock("@/server/bangumi/service", () => ({
    loadBangumiCollections: vi.fn(),
}));

vi.mock("@/server/bangumi/token", () => ({
    decryptBangumiAccessToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/server/directus-auth", () => ({
    buildPublicAssetUrl: vi.fn((id: string) => `/api/v1/public/assets/${id}`),
}));

import { readMany } from "@/server/directus/client";
import { getAuthorBundle } from "@/server/api/v1/shared/author-cache";
import { loadBangumiCollections } from "@/server/bangumi/service";
import { loadUserHomeData } from "@/server/api/v1/public-data";

const mockedReadMany = vi.mocked(readMany);
const mockedGetAuthorBundle = vi.mocked(getAuthorBundle);
const mockedLoadBangumiCollections = vi.mocked(loadBangumiCollections);

describe("public-data bangumi profile sanitization", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const profile = mockProfile({
            username: "alice",
            user_id: "user-1",
            profile_public: true,
            bangumi_username: "914320",
            bangumi_include_private: true,
            bangumi_access_token_encrypted: "v1:encrypted-token",
        });

        mockedReadMany.mockImplementation(async (collection) => {
            if (collection === "app_user_profiles") {
                return [profile];
            }
            return [];
        });

        mockedGetAuthorBundle.mockResolvedValue(
            new Map([
                [
                    "user-1",
                    {
                        id: "user-1",
                        name: "Alice",
                        username: "alice",
                    },
                ],
            ]),
        );

        mockedLoadBangumiCollections.mockResolvedValue({
            items: [],
            page: 1,
            limit: 20,
            total: 0,
        });
    });

    it("does not leak encrypted bangumi token in public response", async () => {
        const result = await loadUserHomeData("alice");

        expect(result.status).toBe("ok");
        if (result.status !== "ok") {
            return;
        }

        expect(
            "bangumi_access_token_encrypted" in
                (result.data.profile as Record<string, unknown>),
        ).toBe(false);
        expect(result.data.profile.bangumi_include_private).toBe(true);
        expect(mockedLoadBangumiCollections).toHaveBeenCalledWith(
            expect.objectContaining({
                includePrivate: false,
                limit: 20,
            }),
        );
    });
});
