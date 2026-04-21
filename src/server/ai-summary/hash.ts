import { createHash } from "node:crypto";

import type { AiSummaryTargetLength } from "@/types/app";

export function buildSummaryContentHash(input: {
    title: string;
    bodyMarkdown: string;
}): string {
    return createHash("sha256")
        .update(`${String(input.title || "").trim()}\n${input.bodyMarkdown}`)
        .digest("hex");
}

export function buildSummaryJobDedupeKey(input: {
    articleId: string;
    contentHash: string;
    promptVersion: string;
    targetLength: AiSummaryTargetLength;
}): string {
    return [
        `article:${input.articleId}`,
        `hash:${input.contentHash}`,
        `prompt:${input.promptVersion}`,
        `target:${input.targetLength}`,
    ].join(":");
}
