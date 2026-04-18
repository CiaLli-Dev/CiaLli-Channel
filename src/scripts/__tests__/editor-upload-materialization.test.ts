import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { materializePendingUploads as materializeArticlePendingUploads } from "@/scripts/publish/page-submit";
import {
    materializePendingUploads as materializeDiaryPendingUploads,
    type PendingDiaryUpload,
} from "@/scripts/diary-editor/helpers";
import type { PendingUpload } from "@/scripts/publish/page-helpers";

const { requestApi } = vi.hoisted(() => ({
    requestApi: vi.fn(),
}));

vi.mock("@/scripts/shared/http-client", () => ({
    requestApi,
}));

vi.mock("@/utils/navigation-utils", () => ({
    navigateToPage: vi.fn(),
}));

vi.mock("@/utils/csrf", () => ({
    getCsrfToken: () => "csrf-token",
}));

describe("editor upload materialization", () => {
    beforeEach(() => {
        requestApi.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("文章上传物化只生成保存 payload，不提前提交本地待上传缓存", async () => {
        const localUrl = "blob:article-inline";
        const pendingUploads = new Map<string, PendingUpload>([
            [
                localUrl,
                {
                    file: new File(["image"], "article.png", {
                        type: "image/png",
                    }),
                    localUrl,
                    purpose: "inline",
                    fileName: "article.png",
                },
            ],
        ]);
        const revokeObjectUrl = vi
            .spyOn(URL, "revokeObjectURL")
            .mockImplementation(() => undefined);
        requestApi.mockResolvedValueOnce({
            response: new Response(JSON.stringify({ ok: true }), {
                status: 200,
            }),
            data: {
                ok: true,
                file: { id: "article-file-1" },
            },
        });

        const result = await materializeArticlePendingUploads(
            pendingUploads,
            `正文 ![](${localUrl})`,
            makePublishState(),
            makeSaveOverlay(),
        );

        expect(result.body).toBe("正文 ![](/api/v1/assets/article-file-1)");
        expect(pendingUploads.has(localUrl)).toBe(true);
        expect(revokeObjectUrl).not.toHaveBeenCalled();
    });

    it("日记上传物化只生成保存 payload，不提前提交本地待上传缓存", async () => {
        const localUrl = "blob:diary-inline";
        const pendingUploads = new Map<string, PendingDiaryUpload>([
            [
                localUrl,
                {
                    file: new File(["image"], "diary.png", {
                        type: "image/png",
                    }),
                    localUrl,
                },
            ],
        ]);
        const revokeObjectUrl = vi
            .spyOn(URL, "revokeObjectURL")
            .mockImplementation(() => undefined);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        file: { id: "diary-file-1" },
                    }),
                    { status: 200 },
                );
            }),
        );

        const result = await materializeDiaryPendingUploads(
            `正文 ![](${localUrl})`,
            pendingUploads,
            null,
        );

        expect(result.content).toBe(
            "正文 ![](/api/v1/public/assets/diary-file-1)",
        );
        expect(pendingUploads.has(localUrl)).toBe(true);
        expect(revokeObjectUrl).not.toHaveBeenCalled();
    });
});

function makePublishState(): import("@/scripts/publish/page-submit").PublishState {
    return {
        currentItemId: "",
        currentItemShortId: "",
        currentStatus: "",
        currentCoverFileId: "",
        currentUsername: "alice",
        isLoggedIn: true,
        previewError: "",
        previewHtml: "",
        previewSource: "",
        previewDirty: false,
        renderedPreviewHtml: "",
        previewGeneration: 0,
        previewFastTimer: null,
        previewFullTimer: null,
        initializedAfterLogin: true,
        loadedEncryptedBody: "",
        loadedEncryptedBodyUnlocked: false,
        inlineImageCounter: 0,
    };
}

function makeSaveOverlay(): import("@/scripts/shared/save-progress-overlay").SaveProgressOverlay {
    return {
        show: vi.fn(),
        hide: vi.fn(),
        update: vi.fn(),
        destroy: vi.fn(),
    } as unknown as import("@/scripts/shared/save-progress-overlay").SaveProgressOverlay;
}
