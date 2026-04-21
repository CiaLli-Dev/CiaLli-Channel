import type { SiteLanguage } from "@/types/config";

export const AI_SUMMARY_PROMPT_VERSION_BASE = "v3";

export type AiSummaryPromptLanguage = Extract<
    SiteLanguage,
    "en" | "zh_CN" | "zh_TW" | "ja"
>;

export type AiSummaryChatMessage = {
    role: "system" | "user";
    content: string;
};

type AiSummaryPromptCopy = {
    chunkSystem: string;
    chunkUserTitleLabel: string;
    chunkUserIndexLabel: string;
    chunkUserInstruction: string;
    finalSystem: string;
    finalUserTitleLabel: string;
    finalUserInstruction: string;
};

const AI_SUMMARY_PROMPT_COPIES: Record<
    AiSummaryPromptLanguage,
    AiSummaryPromptCopy
> = {
    en: {
        chunkSystem:
            "You are CiaLli's article summarization assistant. Stay faithful to the source text, compress information in English, and do not add facts not present in the original. The output language must match the site's language setting. Write mainly in natural paragraphs. Do not use Markdown headings, lists, code blocks, tables, blockquotes, links, or image syntax.",
        chunkUserTitleLabel: "Article title",
        chunkUserIndexLabel: "Current chunk",
        chunkUserInstruction:
            "Compress this chunk into 1 concise natural paragraph, preserving key entities, conclusions, and facts. Do not use bullet points, numbered lists, or subheadings.",
        finalSystem:
            "You are CiaLli's article summarization assistant. Write an 80-160 word English summary that stays faithful to the source text and avoids first-person narration. The output language must match the site's language setting. The final result should be 1-2 natural paragraphs. Do not use Markdown headings, lists, code blocks, tables, blockquotes, links, image syntax, or bold emphasis. Do not start with phrases like 'This article mainly introduces'.",
        finalUserTitleLabel: "Article title",
        finalUserInstruction:
            "Below are chunk summaries of the article. Merge them into the final summary. Output plain paragraph text only. Do not use bullet points, numbering, or subheadings:",
    },
    zh_CN: {
        chunkSystem:
            "你是 CiaLli 的文章摘要助手。请忠于原文，用简体中文压缩信息，不添加原文没有的信息。输出语言必须与站点语言设置一致。输出以自然段为主，不使用 Markdown 标题、列表、代码块、表格、引用、链接或图片语法。",
        chunkUserTitleLabel: "文章标题",
        chunkUserIndexLabel: "当前分块",
        chunkUserInstruction:
            "请将这个分块压缩成 1 个简洁自然段，保留关键对象、结论和事实。不要写项目符号、编号列表或小标题。",
        finalSystem:
            "你是 CiaLli 的文章摘要助手。请输出 80-160 字简体中文摘要，忠于原文且不使用第一人称。输出语言必须与站点语言设置一致。最终结果应是 1-2 个自然段，以段落文本为主；不要输出 Markdown 标题、列表、代码块、表格、引用、链接、图片语法或加粗强调；不要写“本文主要介绍”。",
        finalUserTitleLabel: "文章标题",
        finalUserInstruction:
            "以下是文章分块摘要，请合并成最终摘要。输出纯段落文本，不要使用项目符号、编号或小标题：",
    },
    zh_TW: {
        chunkSystem:
            "你是 CiaLli 的文章摘要助手。請忠於原文，用繁體中文壓縮資訊，不添加原文沒有的內容。輸出語言必須與站點語言設定一致。輸出以自然段為主，不使用 Markdown 標題、列表、程式碼區塊、表格、引用、連結或圖片語法。",
        chunkUserTitleLabel: "文章標題",
        chunkUserIndexLabel: "目前分塊",
        chunkUserInstruction:
            "請將這個分塊壓縮成 1 個簡潔自然段，保留關鍵對象、結論和事實。不要寫項目符號、編號列表或小標題。",
        finalSystem:
            "你是 CiaLli 的文章摘要助手。請輸出 80-160 字繁體中文摘要，忠於原文且不使用第一人稱。輸出語言必須與站點語言設定一致。最終結果應是 1-2 個自然段，以段落文字為主；不要輸出 Markdown 標題、列表、程式碼區塊、表格、引用、連結、圖片語法或粗體強調；不要寫「本文主要介紹」。",
        finalUserTitleLabel: "文章標題",
        finalUserInstruction:
            "以下是文章分塊摘要，請合併成最終摘要。輸出純段落文字，不要使用項目符號、編號或小標題：",
    },
    ja: {
        chunkSystem:
            "あなたは CiaLli の記事要約アシスタントです。原文に忠実であり、情報を日本語で圧縮し、原文にない事実は追加しないでください。出力言語はサイトの言語設定と一致させてください。自然な段落を中心に出力し、Markdown の見出し、箇条書き、コードブロック、表、引用、リンク、画像記法は使わないでください。",
        chunkUserTitleLabel: "記事タイトル",
        chunkUserIndexLabel: "現在のチャンク",
        chunkUserInstruction:
            "このチャンクを 1 つの簡潔で自然な段落に圧縮し、重要な対象、結論、事実を残してください。箇条書き、番号付きリスト、小見出しは使わないでください。",
        finalSystem:
            "あなたは CiaLli の記事要約アシスタントです。原文に忠実で、一人称を使わない 80〜160 文字の日本語要約を作成してください。出力言語はサイトの言語設定と一致させてください。最終結果は 1〜2 段落の自然な文章にし、Markdown の見出し、箇条書き、コードブロック、表、引用、リンク、画像記法、強調表現は使わないでください。『この記事では主に』のような書き出しは避けてください。",
        finalUserTitleLabel: "記事タイトル",
        finalUserInstruction:
            "以下は記事のチャンク要約です。これらを統合して最終要約にしてください。段落テキストのみを出力し、箇条書き、番号、小見出しは使わないでください:",
    },
};

export function resolveAiSummaryPromptLanguage(
    language: string | null | undefined,
): AiSummaryPromptLanguage {
    switch (String(language || "").trim()) {
        case "zh_CN":
        case "zh_TW":
        case "ja":
        case "en":
            return String(language).trim() as AiSummaryPromptLanguage;
        default:
            return "en";
    }
}

export function resolveAiSummaryPromptVersion(
    language: string | null | undefined,
): string {
    return `${AI_SUMMARY_PROMPT_VERSION_BASE}:${resolveAiSummaryPromptLanguage(language)}`;
}

export function buildChunkSummaryMessages(input: {
    language: string;
    title: string;
    chunk: string;
    chunkIndex: number;
    chunkCount: number;
}): AiSummaryChatMessage[] {
    const language = resolveAiSummaryPromptLanguage(input.language);
    const copy = AI_SUMMARY_PROMPT_COPIES[language];

    return [
        {
            role: "system",
            content: copy.chunkSystem,
        },
        {
            role: "user",
            content: [
                `${copy.chunkUserTitleLabel}：${input.title}`,
                `${copy.chunkUserIndexLabel}：${input.chunkIndex + 1}/${input.chunkCount}`,
                copy.chunkUserInstruction,
                input.chunk,
            ].join("\n\n"),
        },
    ];
}

export function buildFinalSummaryMessages(input: {
    language: string;
    title: string;
    chunkSummaries: string[];
}): AiSummaryChatMessage[] {
    const language = resolveAiSummaryPromptLanguage(input.language);
    const copy = AI_SUMMARY_PROMPT_COPIES[language];

    return [
        {
            role: "system",
            content: copy.finalSystem,
        },
        {
            role: "user",
            content: [
                `${copy.finalUserTitleLabel}：${input.title}`,
                copy.finalUserInstruction,
                input.chunkSummaries.join("\n\n"),
            ].join("\n\n"),
        },
    ];
}

export function normalizeAiSummaryText(summary: string): string {
    const lines = String(summary || "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    const cleanedLines: string[] = [];
    let inFence = false;

    for (const line of lines) {
        if (/^```/u.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            continue;
        }

        const cleaned = line
            .replace(/^#{1,6}\s+/u, "")
            .replace(/^>\s*/u, "")
            .replace(/^(?:[-*+]|\d+[.)])\s+/u, "")
            .replace(/\*\*([^*]+)\*\*/gu, "$1")
            .replace(/__([^_]+)__/gu, "$1")
            .replace(/\*([^*]+)\*/gu, "$1")
            .replace(/_([^_]+)_/gu, "$1")
            .replace(/`([^`]+)`/gu, "$1")
            .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
            .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
            .replace(/\s+/gu, " ")
            .trim();

        if (cleaned) {
            cleanedLines.push(cleaned);
        }
    }

    return cleanedLines.join("\n\n").trim();
}
