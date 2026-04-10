export type MarkdownSyntaxDiagnosticSeverity = "error" | "warning";

export type MarkdownSyntaxDiagnostic = {
    message: string;
    severity: MarkdownSyntaxDiagnosticSeverity;
    line: number;
    startColumn: number;
    endColumn: number;
};

type FenceToken = {
    marker: "`" | "~";
    count: number;
    startColumn: number;
};

type ListToken = {
    indentWidth: number;
    markerColumn: number;
};

function resolveFenceToken(line: string): FenceToken | null {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) {
        return null;
    }
    const token = String(match[1] || "");
    const marker = token.startsWith("`") ? "`" : "~";
    const leadingSpaces = match[0].length - token.length;
    return {
        marker,
        count: token.length,
        startColumn: leadingSpaces + 1,
    };
}

function countUnescapedBackticks(line: string): {
    count: number;
    firstColumn: number;
} {
    let count = 0;
    let firstColumn = 1;
    for (let i = 0; i < line.length; i += 1) {
        if (line[i] !== "`") {
            continue;
        }
        if (i > 0 && line[i - 1] === "\\") {
            continue;
        }
        count += 1;
        if (count === 1) {
            firstColumn = i + 1;
        }
    }
    return { count, firstColumn };
}

function findUnclosedLinkStart(line: string): number {
    let cursor = 0;
    while (cursor < line.length) {
        const middle = line.indexOf("](", cursor);
        if (middle < 0) {
            return -1;
        }
        const leftBracket = line.lastIndexOf("[", middle);
        if (leftBracket < 0) {
            cursor = middle + 2;
            continue;
        }
        const closeParen = line.indexOf(")", middle + 2);
        if (closeParen < 0) {
            return middle + 1;
        }
        cursor = closeParen + 1;
    }
    return -1;
}

function countIndentWidth(rawIndent: string): number {
    let width = 0;
    for (const char of rawIndent) {
        if (char === "\t") {
            width += 4;
        } else {
            width += 1;
        }
    }
    return width;
}

function resolveListToken(line: string): ListToken | null {
    const match = line.match(/^([ \t]*)(?:[-*+]|\d+\.)\s+/);
    if (!match) {
        return null;
    }
    const rawIndent = String(match[1] || "");
    return {
        indentWidth: countIndentWidth(rawIndent),
        markerColumn: rawIndent.length + 1,
    };
}

function pushHeadingSpacingDiagnostic(
    diagnostics: MarkdownSyntaxDiagnostic[],
    line: string,
    lineNo: number,
): void {
    if (!/^ {0,3}#{1,6}(?!\s|#)/.test(line)) {
        return;
    }
    const headingMatch = line.match(/^ {0,3}(#{1,6})/);
    const markerLength = headingMatch?.[1]?.length ?? 1;
    diagnostics.push({
        message: "标题语法 '#...' 需要在 # 后添加一个空格",
        severity: "error",
        line: lineNo,
        startColumn: 1,
        endColumn: markerLength + 1,
    });
}

function pushListIndentDiagnostics(
    diagnostics: MarkdownSyntaxDiagnostic[],
    line: string,
    lineNo: number,
    prevListIndentWidth: number | null,
): number | null {
    const listToken = resolveListToken(line);
    if (!listToken) {
        return null;
    }
    if (listToken.indentWidth % 2 !== 0) {
        diagnostics.push({
            message: "列表缩进建议使用偶数空格，当前缩进可能导致层级异常",
            severity: "warning",
            line: lineNo,
            startColumn: 1,
            endColumn: listToken.markerColumn,
        });
    }
    if (
        prevListIndentWidth !== null &&
        listToken.indentWidth - prevListIndentWidth > 4
    ) {
        diagnostics.push({
            message: "列表缩进层级跳跃过大，请逐级增加缩进",
            severity: "warning",
            line: lineNo,
            startColumn: 1,
            endColumn: listToken.markerColumn,
        });
    }
    return listToken.indentWidth;
}

function pushInlineSyntaxDiagnostics(
    diagnostics: MarkdownSyntaxDiagnostic[],
    line: string,
    lineNo: number,
): void {
    const unclosedLinkColumn = findUnclosedLinkStart(line);
    if (unclosedLinkColumn > 0) {
        diagnostics.push({
            message: "Markdown 链接或图片语法缺少右括号 ')'",
            severity: "error",
            line: lineNo,
            startColumn: unclosedLinkColumn,
            endColumn: line.length + 1,
        });
    }

    const backticks = countUnescapedBackticks(line);
    if (backticks.count % 2 === 1) {
        diagnostics.push({
            message: "检测到未闭合的行内代码反引号 '`'",
            severity: "warning",
            line: lineNo,
            startColumn: backticks.firstColumn,
            endColumn: backticks.firstColumn + 1,
        });
    }
}

export function analyzeMarkdownSyntax(
    source: string,
): MarkdownSyntaxDiagnostic[] {
    const diagnostics: MarkdownSyntaxDiagnostic[] = [];
    const lines = String(source || "")
        .replaceAll("\r\n", "\n")
        .split("\n");
    let openFence: {
        line: number;
        token: FenceToken;
    } | null = null;
    let prevListIndentWidth: number | null = null;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        const lineNo = i + 1;
        const fence = resolveFenceToken(line);

        if (fence) {
            if (
                openFence &&
                openFence.token.marker === fence.marker &&
                fence.count >= openFence.token.count
            ) {
                openFence = null;
                continue;
            }
            if (!openFence) {
                openFence = { line: lineNo, token: fence };
            }
            continue;
        }

        if (openFence) {
            continue;
        }

        pushHeadingSpacingDiagnostic(diagnostics, line, lineNo);
        prevListIndentWidth = pushListIndentDiagnostics(
            diagnostics,
            line,
            lineNo,
            prevListIndentWidth,
        );
        pushInlineSyntaxDiagnostics(diagnostics, line, lineNo);
    }

    if (openFence) {
        diagnostics.push({
            // 代码块未闭合通常会导致后续 Markdown 结构全部偏移，因此按错误级别提示。
            message: "代码块围栏未闭合，请补充对应的结束围栏",
            severity: "error",
            line: openFence.line,
            startColumn: openFence.token.startColumn,
            endColumn: openFence.token.startColumn + openFence.token.count,
        });
    }

    return diagnostics;
}
