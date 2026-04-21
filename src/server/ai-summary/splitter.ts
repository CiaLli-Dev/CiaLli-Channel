type SplitOptions = {
    targetChars?: number;
    maxChars?: number;
};

const DEFAULT_TARGET_CHARS = 6000;
const DEFAULT_MAX_CHARS = 8000;

function splitOversizedBlock(block: string, maxChars: number): string[] {
    if (block.length <= maxChars) {
        return [block];
    }
    const chunks: string[] = [];
    for (let index = 0; index < block.length; index += maxChars) {
        chunks.push(block.slice(index, index + maxChars));
    }
    return chunks;
}

function splitMarkdownBlocks(markdown: string): string[] {
    const lines = String(markdown || "").split(/\r?\n/u);
    const blocks: string[] = [];
    let current: string[] = [];
    let inFence = false;

    const flush = (): void => {
        const value = current.join("\n").trim();
        if (value) {
            blocks.push(value);
        }
        current = [];
    };

    for (const line of lines) {
        const isFence = /^\s*```/u.test(line);
        if (!inFence && /^#{1,6}\s+/u.test(line)) {
            flush();
        }
        current.push(line);
        if (isFence) {
            inFence = !inFence;
        }
        if (!inFence && !line.trim()) {
            flush();
        }
    }
    flush();
    return blocks;
}

export function splitMarkdownForSummary(
    markdown: string,
    options: SplitOptions = {},
): string[] {
    const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const blocks = splitMarkdownBlocks(markdown).flatMap((block) =>
        splitOversizedBlock(block, maxChars),
    );
    const chunks: string[] = [];
    let current = "";

    for (const block of blocks) {
        const next = current ? `${current}\n\n${block}` : block;
        if (next.length > targetChars && current) {
            chunks.push(current);
            current = block;
            continue;
        }
        current = next;
    }
    if (current) {
        chunks.push(current);
    }
    return chunks.length > 0 ? chunks : [String(markdown || "")];
}
