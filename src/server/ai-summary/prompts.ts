export const AI_SUMMARY_PROMPT_VERSION = "v1";

export type AiSummaryChatMessage = {
    role: "system" | "user";
    content: string;
};

export function buildChunkSummaryMessages(input: {
    title: string;
    chunk: string;
    chunkIndex: number;
    chunkCount: number;
}): AiSummaryChatMessage[] {
    return [
        {
            role: "system",
            content:
                "你是 CiaLli 的文章摘要助手。请忠于原文，用中文提炼要点，不添加原文没有的信息。",
        },
        {
            role: "user",
            content: [
                `文章标题：${input.title}`,
                `当前分块：${input.chunkIndex + 1}/${input.chunkCount}`,
                "请用 3-5 条要点概括这个分块，保留关键对象、结论和事实。",
                input.chunk,
            ].join("\n\n"),
        },
    ];
}

export function buildFinalSummaryMessages(input: {
    title: string;
    chunkSummaries: string[];
}): AiSummaryChatMessage[] {
    return [
        {
            role: "system",
            content:
                "你是 CiaLli 的文章摘要助手。请输出 80-160 字中文摘要，不使用第一人称，不输出 Markdown 标题，不写“本文主要介绍”。",
        },
        {
            role: "user",
            content: [
                `文章标题：${input.title}`,
                "以下是文章分块摘要，请合并成最终摘要：",
                input.chunkSummaries.join("\n\n"),
            ].join("\n\n"),
        },
    ];
}
