import { describe, it, expect } from "vitest";

import {
    normalizeStatus,
    normalizeAppRole,
    normalizeWatchStatus,
    normalizeAlbumLayout,
    normalizeCommentStatus,
    normalizeRegistrationRequestStatus,
} from "@/server/api/v1/shared/normalize";

describe("normalizeStatus", () => {
    it("合法值直接返回", () => {
        expect(normalizeStatus("draft")).toBe("draft");
        expect(normalizeStatus("published")).toBe("published");
        expect(normalizeStatus("archived")).toBe("archived");
    });
    it("非法值返回 fallback", () => {
        expect(normalizeStatus("invalid")).toBe("draft");
        expect(normalizeStatus("invalid", "published")).toBe("published");
    });
});

describe("normalizeAppRole", () => {
    it("admin → admin", () => {
        expect(normalizeAppRole("admin")).toBe("admin");
    });
    it("其他 → member", () => {
        expect(normalizeAppRole("member")).toBe("member");
        expect(normalizeAppRole("invalid")).toBe("member");
    });
});

describe("normalizeWatchStatus", () => {
    it("合法值直接返回", () => {
        expect(normalizeWatchStatus("watching")).toBe("watching");
        expect(normalizeWatchStatus("completed")).toBe("completed");
        expect(normalizeWatchStatus("planned")).toBe("planned");
        expect(normalizeWatchStatus("onhold")).toBe("onhold");
        expect(normalizeWatchStatus("dropped")).toBe("dropped");
    });
    it("非法值 → planned", () => {
        expect(normalizeWatchStatus("invalid")).toBe("planned");
    });
});

describe("normalizeAlbumLayout", () => {
    it("masonry → masonry", () => {
        expect(normalizeAlbumLayout("masonry")).toBe("masonry");
    });
    it("其他 → grid", () => {
        expect(normalizeAlbumLayout("grid")).toBe("grid");
        expect(normalizeAlbumLayout("invalid")).toBe("grid");
    });
});

describe("normalizeCommentStatus", () => {
    it("合法值直接返回", () => {
        expect(normalizeCommentStatus("published")).toBe("published");
        expect(normalizeCommentStatus("hidden")).toBe("hidden");
        expect(normalizeCommentStatus("archived")).toBe("archived");
    });
    it("非法值返回 fallback", () => {
        expect(normalizeCommentStatus("invalid")).toBe("published");
        expect(normalizeCommentStatus("invalid", "hidden")).toBe("hidden");
    });
});

describe("normalizeRegistrationRequestStatus", () => {
    it("合法值直接返回", () => {
        expect(normalizeRegistrationRequestStatus("pending")).toBe("pending");
        expect(normalizeRegistrationRequestStatus("approved")).toBe("approved");
        expect(normalizeRegistrationRequestStatus("rejected")).toBe("rejected");
        expect(normalizeRegistrationRequestStatus("cancelled")).toBe(
            "cancelled",
        );
    });
    it("非法值返回 fallback", () => {
        expect(normalizeRegistrationRequestStatus("invalid")).toBe("pending");
        expect(normalizeRegistrationRequestStatus("invalid", "rejected")).toBe(
            "rejected",
        );
    });
});
