import { describe, it, expect } from "vitest";
import * as z from "zod";

import {
    CreateDiarySchema,
    UpdateDiarySchema,
} from "@/server/api/schemas/diary";

describe("CreateDiarySchema", () => {
    it("仅 content → 通过（使用默认值）", () => {
        const result = CreateDiarySchema.parse({
            content: "今天写点什么",
        });
        expect(result.content).toBe("今天写点什么");
        expect(result.status).toBe("published");
        expect(result.allow_comments).toBe(true);
        expect(result.praviate).toBe(true);
    });

    it("status=draft → 失败", () => {
        expect(() =>
            CreateDiarySchema.parse({
                content: "草稿内容",
                status: "draft",
            }),
        ).toThrow(z.ZodError);
    });
});

describe("UpdateDiarySchema", () => {
    it("空对象 → 通过", () => {
        const result = UpdateDiarySchema.parse({});
        expect(result).toEqual({});
    });

    it("部分更新 → 通过", () => {
        const result = UpdateDiarySchema.parse({
            content: "更新后的内容",
            praviate: false,
        });
        expect(result.content).toBe("更新后的内容");
        expect(result.praviate).toBe(false);
    });
});
