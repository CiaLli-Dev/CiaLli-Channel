const COPY_SUCCESS_DURATION_MS = 1000;

type RuntimeWindow = Window &
    typeof globalThis & {
        __dcCodeCopyDelegated?: boolean;
    };

function extractCodeText(codeElement: HTMLElement): string {
    const lineElements = codeElement.querySelectorAll<HTMLElement>("span.line");
    if (lineElements.length > 0) {
        const lines = Array.from(
            lineElements,
            (lineElement) => lineElement.textContent || "",
        );
        return lines.join("\n");
    }

    const explicitCodeLines = codeElement.querySelectorAll<HTMLElement>(
        ".code:not(summary *)",
    );
    if (explicitCodeLines.length > 0) {
        const lines = Array.from(
            explicitCodeLines,
            (lineElement) => lineElement.textContent || "",
        );
        return lines.join("\n");
    }

    return codeElement.textContent || "";
}

function normalizeCopiedCode(rawCode: string): string {
    return rawCode.replace(/\n{3,}/g, (match) => {
        const emptyLineCount = Math.max(0, match.length - 1);
        const normalizedEmptyLines = Math.max(1, Math.ceil(emptyLineCount / 2));
        return "\n".repeat(normalizedEmptyLines + 1);
    });
}

function writeClipboardWithExecCommand(text: string): boolean {
    type LegacyExecCommand = (commandId: string) => unknown;
    const rawExecCommand = (document as unknown as Record<string, unknown>)[
        "execCommand"
    ];
    const execCommand =
        typeof rawExecCommand === "function"
            ? (rawExecCommand as LegacyExecCommand)
            : null;

    if (!document.body || !execCommand) {
        return false;
    }

    const activeElement =
        document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    const selection = document.getSelection();
    const selectedRange =
        selection && selection.rangeCount > 0
            ? selection.getRangeAt(0).cloneRange()
            : null;

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    textArea.style.opacity = "0";
    textArea.style.pointerEvents = "none";

    document.body.append(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);

    const copied = (() => {
        try {
            return execCommand.call(document, "copy") === true;
        } catch {
            return false;
        }
    })();

    textArea.remove();

    if (selection) {
        selection.removeAllRanges();
        if (selectedRange) {
            selection.addRange(selectedRange);
        }
    }

    if (activeElement && document.contains(activeElement)) {
        activeElement.focus();
    }

    return copied;
}

async function writeClipboard(text: string): Promise<void> {
    const canUseClipboardApi =
        window.isSecureContext &&
        typeof navigator.clipboard?.writeText === "function";
    if (canUseClipboardApi) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            if (writeClipboardWithExecCommand(text)) {
                return;
            }
            throw new Error("Clipboard API 调用失败，且降级复制失败");
        }
    }

    if (writeClipboardWithExecCommand(text)) {
        return;
    }

    throw new Error("Clipboard API 不可用，且降级复制失败");
}

function markCopySuccess(button: HTMLElement): void {
    const timeoutId = button.getAttribute("data-timeout-id");
    if (timeoutId) {
        clearTimeout(Number.parseInt(timeoutId, 10));
    }

    button.classList.add("success");

    const newTimeoutId = window.setTimeout(() => {
        button.classList.remove("success");
    }, COPY_SUCCESS_DURATION_MS);

    button.setAttribute("data-timeout-id", String(newTimeoutId));
}

export async function copyCodeFromButton(button: HTMLElement): Promise<void> {
    const codeScope =
        button.closest<HTMLElement>(".expressive-code, figure, pre") ??
        button.parentElement;
    const codeElement = codeScope?.querySelector<HTMLElement>("code");
    if (!codeElement) {
        return;
    }

    const code = normalizeCopiedCode(extractCodeText(codeElement));
    await writeClipboard(code);
    markCopySuccess(button);
}

function handleDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const copyButton = target.closest<HTMLElement>(".copy-btn");
    if (!copyButton) {
        return;
    }

    void copyCodeFromButton(copyButton).catch((error) => {
        console.error("[markdown] copy code failed:", error);
    });
}

export function setupCodeCopyDelegation(): void {
    const runtimeWindow = window as RuntimeWindow;
    if (runtimeWindow.__dcCodeCopyDelegated) {
        return;
    }

    document.addEventListener("click", handleDocumentClick);
    runtimeWindow.__dcCodeCopyDelegated = true;
}
