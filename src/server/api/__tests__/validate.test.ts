import { describe, it, expect } from "vitest";
import * as z from "zod";

import { validateBody, validateQuery } from "@/server/api/validate";
import { AppError } from "@/server/api/errors";

const TestSchema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
});

describe("validateBody", () => {
    it("成功路径", () => {
        const result = validateBody(TestSchema, { name: "Alice", age: 25 });
        expect(result).toEqual({ name: "Alice", age: 25 });
    });

    it("失败抛出 AppError(400, VALIDATION_ERROR)", () => {
        expect(() => validateBody(TestSchema, { name: "", age: -1 })).toThrow(
            AppError,
        );
        try {
            validateBody(TestSchema, { name: "" });
        } catch (error) {
            const appError = error as AppError;
            expect(appError.status).toBe(400);
            expect(appError.code).toBe("VALIDATION_ERROR");
        }
    });

    it("多字段错误拼接含 path", () => {
        try {
            validateBody(TestSchema, { name: "", age: "abc" });
        } catch (error) {
            const appError = error as AppError;
            expect(appError.message).toContain("name");
        }
    });
});

describe("validateQuery", () => {
    const QuerySchema = z.object({
        page: z.coerce.number().int().positive().default(1),
        q: z.string().optional(),
    });

    it("成功路径：从 URLSearchParams 转换", () => {
        const params = new URLSearchParams("page=3&q=hello");
        const result = validateQuery(QuerySchema, params);
        expect(result).toEqual({ page: 3, q: "hello" });
    });

    it("失败抛出 VALIDATION_ERROR", () => {
        const InvalidSchema = z.object({
            required_field: z.string().min(1),
        });
        expect(() =>
            validateQuery(InvalidSchema, new URLSearchParams()),
        ).toThrow(AppError);
    });
});
