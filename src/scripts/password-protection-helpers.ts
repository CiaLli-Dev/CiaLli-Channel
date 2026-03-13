type PasswordProtectionWindow = Window &
    typeof globalThis & {
        __ppFromBase64Url?: (input: unknown) => Uint8Array;
        __ppSanitizeDecryptedHtml?: (rawHtml: unknown) => string;
        __ppResolveProtectedHtml?: (rawContent: unknown) => string;
        __ppDecryptPayloadV2?: (
            input: unknown,
            password: string,
        ) => Promise<string>;
        __ppDispatchPostDecryptTasks?: (
            contentBodyDiv: HTMLElement,
        ) => Promise<void>;
    };

function fromBase64Url(input: unknown): Uint8Array {
    const normalized = String(input || "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padLength =
        normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        output[i] = binary.charCodeAt(i);
    }
    return output;
}

function toCryptoBuffer(input: unknown): ArrayBuffer {
    const bytes = fromBase64Url(input);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function removeUnsafeAttributes(element: Element): void {
    const attributes = Array.from(element.attributes || []);
    attributes.forEach((attribute) => {
        const attrName = attribute.name.toLowerCase();
        const attrValue = String(attribute.value || "")
            .trim()
            .toLowerCase();
        if (attrName.startsWith("on")) {
            element.removeAttribute(attribute.name);
            return;
        }
        if (
            (attrName === "href" ||
                attrName === "src" ||
                attrName === "xlink:href") &&
            attrValue.startsWith("javascript:")
        ) {
            element.removeAttribute(attribute.name);
        }
    });
}

function sanitizeDecryptedHtml(rawHtml: unknown): string {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(rawHtml || ""), "text/html");
    parsed.querySelectorAll("script,object,embed").forEach((node) => {
        node.remove();
    });
    parsed.querySelectorAll("*").forEach((node) => {
        removeUnsafeAttributes(node);
    });
    return parsed.body.innerHTML;
}

function resolveProtectedHtml(rawContent: unknown): string {
    const source = String(rawContent || "");
    if (!source) {
        throw new Error("INVALID_PROTECTED_CONTENT");
    }
    const parsed: unknown = JSON.parse(source);
    if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as Record<string, unknown>).html !== "string" ||
        !(String((parsed as Record<string, unknown>).html) || "").trim()
    ) {
        throw new Error("INVALID_PROTECTED_CONTENT");
    }
    return String((parsed as Record<string, unknown>).html);
}

async function decryptPayloadV2(
    input: unknown,
    password: string,
): Promise<string> {
    if (!String(input || "").startsWith("CL2:")) {
        throw new Error("UNSUPPORTED_FORMAT");
    }
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error("WEBCRYPTO_UNAVAILABLE");
    }

    const marker = "CIALLI-VERIFY:";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const encodedPayload = String(input).slice("CL2:".length);
    const payloadJson = decoder.decode(fromBase64Url(encodedPayload));
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    if (
        payload?.v !== 2 ||
        payload?.kdf !== "PBKDF2" ||
        payload?.alg !== "AES-GCM" ||
        typeof payload?.it !== "number"
    ) {
        throw new Error("INVALID_PAYLOAD");
    }

    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"],
    );

    const key = await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toCryptoBuffer(payload.s),
            iterations: payload.it as number,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
    );

    const decryptedBytes = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toCryptoBuffer(payload.iv) },
        key,
        toCryptoBuffer(payload.ct),
    );
    const decryptedString = decoder.decode(decryptedBytes);

    if (!decryptedString.startsWith(marker)) {
        throw new Error("PASSWORD_INVALID");
    }
    return decryptedString.slice(marker.length);
}

async function dispatchPostDecryptTasks(
    contentBodyDiv: HTMLElement,
): Promise<void> {
    const tocElement = document.querySelector("table-of-contents") as
        | (Element & { regenerateTOC?: () => void; init?: () => void })
        | null;
    if (tocElement && typeof tocElement.regenerateTOC === "function") {
        tocElement.regenerateTOC();
        tocElement.init?.();
    }

    const fancybox = (window as unknown as Record<string, unknown>)[
        "Fancybox"
    ] as
        | {
              bind: (sel: string, opts: object) => void;
              unbind: (sel: string) => void;
          }
        | undefined;
    if (fancybox?.bind) {
        fancybox.unbind("[data-fancybox]");
        fancybox.bind("[data-fancybox]", {});
    }

    window.dispatchEvent(new CustomEvent("cialli:password-content-ready"));

    const images = contentBodyDiv.querySelectorAll("img");
    images.forEach((img) => {
        if (!img.complete) {
            img.addEventListener("load", () => {
                window.dispatchEvent(new Event("scroll"));
                window.dispatchEvent(new Event("resize"));
            });
        }
    });

    [0, 100, 300, 500, 1000, 2000].forEach((delay) => {
        setTimeout(() => {
            window.dispatchEvent(new Event("scroll"));
            window.dispatchEvent(new Event("resize"));
        }, delay);
    });

    const renderMermaid = (window as unknown as Record<string, unknown>)[
        "renderMermaidDiagrams"
    ];
    if (typeof renderMermaid === "function") {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        (renderMermaid as () => void)();
    }
}

const ppWindow = window as PasswordProtectionWindow;
ppWindow.__ppFromBase64Url = fromBase64Url;
ppWindow.__ppSanitizeDecryptedHtml = sanitizeDecryptedHtml;
ppWindow.__ppResolveProtectedHtml = resolveProtectedHtml;
ppWindow.__ppDecryptPayloadV2 = decryptPayloadV2;
ppWindow.__ppDispatchPostDecryptTasks = dispatchPostDecryptTasks;
