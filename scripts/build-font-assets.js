import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import subsetFont from "subset-font";

import { fontBuildConfig } from "./font-build.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourceFontDir = path.resolve(
    projectRoot,
    fontBuildConfig.sourceDirectory,
);
const outputFontDir = path.resolve(
    projectRoot,
    fontBuildConfig.outputDirectory,
);
const runtimeManifestPath = path.resolve(
    projectRoot,
    fontBuildConfig.generatedRuntimeModule,
);
const jsonManifestPath = path.join(
    outputFontDir,
    fontBuildConfig.generatedManifestFilename,
);
const cssOutputPath = path.join(
    outputFontDir,
    fontBuildConfig.generatedCssFilename,
);

const CJK_CHAR_REGEXP =
    /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u3100-\u312f\u3130-\u318f\u3190-\u31ff\u3200-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;

/**
 * 只扫描可读文本文件，避免把二进制资源误当成字符串
 */
function collectFilesRecursively(dirPath, allowedExtensions, collected = []) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === "dist" ||
            entry.name === ".astro" ||
            entry.name === ".vercel"
        ) {
            continue;
        }
        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collectFilesRecursively(absolutePath, allowedExtensions, collected);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const extension = path.extname(entry.name).toLowerCase();
        if (allowedExtensions.has(extension)) {
            collected.push(absolutePath);
        }
    }
    return collected;
}

function normalizeForCssUrl(fileName) {
    return `/assets/font/${fileName}`;
}

function toStableHash(buffer) {
    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex")
        .slice(0, 12);
}

function formatCodePoint(codePoint) {
    return codePoint.toString(16).toUpperCase().padStart(4, "0");
}

function buildUnicodeRangeFromCharacters(characters) {
    const codePoints = Array.from(
        new Set(Array.from(characters, (char) => char.codePointAt(0) ?? 0)),
    )
        .filter((codePoint) => Number.isFinite(codePoint))
        .sort((a, b) => a - b);

    if (codePoints.length === 0) {
        return "";
    }

    const ranges = [];
    let rangeStart = codePoints[0];
    let previous = codePoints[0];

    for (let index = 1; index < codePoints.length; index += 1) {
        const current = codePoints[index];
        if (current === previous + 1) {
            previous = current;
            continue;
        }
        ranges.push(
            rangeStart === previous
                ? `U+${formatCodePoint(rangeStart)}`
                : `U+${formatCodePoint(rangeStart)}-${formatCodePoint(previous)}`,
        );
        rangeStart = current;
        previous = current;
    }

    ranges.push(
        rangeStart === previous
            ? `U+${formatCodePoint(rangeStart)}`
            : `U+${formatCodePoint(rangeStart)}-${formatCodePoint(previous)}`,
    );

    return ranges.join(", ");
}

function sortCharactersByCodePoint(characters) {
    return Array.from(new Set(Array.from(characters)))
        .sort(
            (left, right) =>
                (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0),
        )
        .join("");
}

function collectScannedCharacters() {
    const cjkChars = new Set();
    const nonCjkChars = new Set();
    const files = [];

    for (const relativeDir of fontBuildConfig.scanDirectories) {
        const absoluteDir = path.resolve(projectRoot, relativeDir);
        if (!fs.existsSync(absoluteDir)) {
            continue;
        }
        collectFilesRecursively(
            absoluteDir,
            fontBuildConfig.scanFileExtensions,
            files,
        );
    }

    for (const filePath of files) {
        const text = fs.readFileSync(filePath, "utf-8");
        for (const char of text) {
            if (CJK_CHAR_REGEXP.test(char)) {
                cjkChars.add(char);
                continue;
            }
            nonCjkChars.add(char);
        }
    }

    return {
        cjkChars: sortCharactersByCodePoint(cjkChars),
        nonCjkChars: sortCharactersByCodePoint(nonCjkChars),
    };
}

function buildAsciiCoreCharacters(scannedNonCjkChars) {
    const codePoints = new Set();

    // 首屏最常见可见字符
    for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
        codePoints.add(codePoint);
    }
    // Latin-1 扩展，覆盖常见西文重音字符
    for (let codePoint = 0xa0; codePoint <= 0xff; codePoint += 1) {
        codePoints.add(codePoint);
    }
    // 常见排版控制字符
    codePoints.add(0x09);
    codePoints.add(0x0a);
    codePoints.add(0x0d);

    const requiredAsciiChars = `${fontBuildConfig.requiredCharacters.ascii || ""}${fontBuildConfig.requiredCharacters.shared || ""}`;
    const scannedChars = `${scannedNonCjkChars || ""}${requiredAsciiChars}`;
    const isAsciiSupplementCodePoint = (codePoint) =>
        (codePoint >= 0x0100 && codePoint <= 0x024f) ||
        (codePoint >= 0x2000 && codePoint <= 0x214f);

    // 控制 ASCII 子集体积上限，仅吸收 Latin 扩展与常见排版符号区
    for (const char of scannedChars) {
        const codePoint = char.codePointAt(0);
        if (typeof codePoint !== "number") {
            continue;
        }
        if (isAsciiSupplementCodePoint(codePoint)) {
            codePoints.add(codePoint);
        }
    }

    return Array.from(codePoints)
        .sort((a, b) => a - b)
        .map((codePoint) => String.fromCodePoint(codePoint))
        .join("");
}

function buildCjkCoreCharacters(scannedCjkChars) {
    return sortCharactersByCodePoint(
        `${scannedCjkChars || ""}${fontBuildConfig.requiredCharacters.cjk || ""}${fontBuildConfig.requiredCharacters.shared || ""}`,
    );
}

async function generateSubsetFont({ sourceFile, subsetCharacters, fileLabel }) {
    const sourcePath = path.join(sourceFontDir, sourceFile);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`字体源文件不存在: ${sourcePath}`);
    }

    const sourceBuffer = fs.readFileSync(sourcePath);
    const subsetBuffer = await subsetFont(sourceBuffer, subsetCharacters, {
        targetFormat: "woff2",
    });
    const hash = toStableHash(subsetBuffer);
    const outputFileName = `${fileLabel}.${hash}.woff2`;
    const outputPath = path.join(outputFontDir, outputFileName);

    fs.writeFileSync(outputPath, subsetBuffer);

    return {
        outputFileName,
        outputPath,
        bytes: subsetBuffer.byteLength,
    };
}

function generateCopiedFont({ sourceFile, fileLabel }) {
    const sourcePath = path.join(sourceFontDir, sourceFile);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`字体源文件不存在: ${sourcePath}`);
    }

    const sourceBuffer = fs.readFileSync(sourcePath);
    const hash = toStableHash(sourceBuffer);
    const outputFileName = `${fileLabel}.${hash}.woff2`;
    const outputPath = path.join(outputFontDir, outputFileName);

    fs.writeFileSync(outputPath, sourceBuffer);

    return {
        outputFileName,
        outputPath,
        bytes: sourceBuffer.byteLength,
    };
}

function ensureOutputDirectories() {
    fs.rmSync(outputFontDir, { recursive: true, force: true });
    fs.mkdirSync(outputFontDir, { recursive: true });
    fs.mkdirSync(path.dirname(runtimeManifestPath), { recursive: true });
}

function createGeneratedCss({
    asciiSubset,
    cjkCoreSubset,
    cjkFullFallback,
    asciiCoreUnicodeRange,
    cjkCoreUnicodeRange,
}) {
    const { ascii, cjk } = fontBuildConfig.fontFaces;

    return `/* 此文件由 scripts/build-font-assets.js 自动生成，请勿手改 */
@font-face {
  font-family: "${ascii.family}";
  src: url("${normalizeForCssUrl(asciiSubset.outputFileName)}") format("woff2");
  font-style: ${ascii.style};
  font-weight: ${ascii.weight};
  font-display: ${ascii.display};
  unicode-range: ${asciiCoreUnicodeRange};
}

@font-face {
  font-family: "${cjk.family}";
  src: url("${normalizeForCssUrl(cjkCoreSubset.outputFileName)}") format("woff2");
  font-style: ${cjk.style};
  font-weight: ${cjk.weight};
  font-display: ${cjk.coreDisplay};
  unicode-range: ${cjkCoreUnicodeRange};
}

@font-face {
  font-family: "${cjk.family}";
  src: url("${normalizeForCssUrl(cjkFullFallback.outputFileName)}") format("woff2");
  font-style: ${cjk.style};
  font-weight: ${cjk.weight};
  font-display: ${cjk.fallbackDisplay};
  unicode-range: ${cjk.fallbackUnicodeRange};
}
`;
}

function writeManifestFiles({
    asciiSubset,
    cjkCoreSubset,
    cjkFullFallback,
    asciiCoreUnicodeRange,
    cjkCoreCharsCount,
    cjkCoreUnicodeRange,
}) {
    const deferredFetchPriority =
        fontBuildConfig.deferredWarmup.fetchpriority || "low";

    const preloadFonts = [];
    if (fontBuildConfig.fontFaces.ascii.preloadCritical) {
        preloadFonts.push({
            href: normalizeForCssUrl(asciiSubset.outputFileName),
            type: "font/woff2",
            crossorigin: "anonymous",
            fetchpriority: "high",
        });
    }
    if (fontBuildConfig.fontFaces.cjk.preloadCritical) {
        preloadFonts.push({
            href: normalizeForCssUrl(cjkCoreSubset.outputFileName),
            type: "font/woff2",
            crossorigin: "anonymous",
            fetchpriority: "high",
        });
    }

    const deferredFonts = [
        {
            href: normalizeForCssUrl(cjkFullFallback.outputFileName),
            type: "font/woff2",
            crossorigin: "anonymous",
            fetchpriority: deferredFetchPriority,
        },
    ];

    const manifest = {
        version: 2,
        generatedAt: new Date().toISOString(),
        cssHref: normalizeForCssUrl(fontBuildConfig.generatedCssFilename),
        preloadFonts,
        deferredFonts,
        deferredWarmup: {
            enabled: Boolean(fontBuildConfig.deferredWarmup.enabled),
            trigger:
                fontBuildConfig.deferredWarmup.trigger || "window-load-idle",
            sessionKey:
                fontBuildConfig.deferredWarmup.sessionKey ||
                "cialli.font.deferred-warmup.v1",
            fetchpriority: deferredFetchPriority,
        },
        files: {
            asciiCore: {
                fileName: asciiSubset.outputFileName,
                sizeBytes: asciiSubset.bytes,
                unicodeRange: asciiCoreUnicodeRange,
            },
            cjkCore: {
                fileName: cjkCoreSubset.outputFileName,
                sizeBytes: cjkCoreSubset.bytes,
                charCount: cjkCoreCharsCount,
                unicodeRange: cjkCoreUnicodeRange,
            },
            cjkFallbackFull: {
                fileName: cjkFullFallback.outputFileName,
                sizeBytes: cjkFullFallback.bytes,
            },
        },
    };

    fs.writeFileSync(
        jsonManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const runtimeModule = `/* 此文件由 scripts/build-font-assets.js 自动生成，请勿手改 */
export type GeneratedFontManifest = {
  cssHref: string;
  preloadFonts: ReadonlyArray<{
    href: string;
    type: "font/woff2";
    crossorigin: "anonymous";
    fetchpriority: "high" | "low" | "auto";
  }>;
  deferredFonts: ReadonlyArray<{
    href: string;
    type: "font/woff2";
    crossorigin: "anonymous";
    fetchpriority: "high" | "low" | "auto";
  }>;
  deferredWarmup: {
    enabled: boolean;
    trigger: "window-load-idle" | "immediate-idle";
    sessionKey: string;
    fetchpriority: "high" | "low" | "auto";
  };
};

export const generatedFontManifest: GeneratedFontManifest = ${JSON.stringify(
        {
            cssHref: manifest.cssHref,
            preloadFonts: manifest.preloadFonts,
            deferredFonts: manifest.deferredFonts,
            deferredWarmup: manifest.deferredWarmup,
        },
        null,
        2,
    )};
`;

    fs.writeFileSync(runtimeManifestPath, runtimeModule);
}

function formatSize(bytes) {
    return `${(bytes / 1024).toFixed(2)} KB`;
}

async function buildFontAssets() {
    ensureOutputDirectories();

    const scannedCharacters = collectScannedCharacters();
    const asciiChars = buildAsciiCoreCharacters(scannedCharacters.nonCjkChars);
    const cjkChars = buildCjkCoreCharacters(scannedCharacters.cjkChars);

    if (!asciiChars) {
        throw new Error("未收集到 ASCII 核心字符，无法生成核心子集字体");
    }
    if (!cjkChars) {
        throw new Error("未收集到 CJK 字符，无法生成核心子集字体");
    }

    const asciiSubset = await generateSubsetFont({
        sourceFile: fontBuildConfig.fontFaces.ascii.sourceFile,
        subsetCharacters: asciiChars,
        fileLabel: "ascii-core",
    });

    const cjkCoreSubset = await generateSubsetFont({
        sourceFile: fontBuildConfig.fontFaces.cjk.sourceFile,
        subsetCharacters: cjkChars,
        fileLabel: "cjk-core",
    });

    const cjkFullFallback = generateCopiedFont({
        sourceFile: fontBuildConfig.fontFaces.cjk.sourceFile,
        fileLabel: "cjk-fallback-full",
    });

    const asciiCoreUnicodeRange = buildUnicodeRangeFromCharacters(asciiChars);
    const cjkCoreUnicodeRange = buildUnicodeRangeFromCharacters(cjkChars);
    if (!asciiCoreUnicodeRange) {
        throw new Error("ASCII unicode-range 为空，无法生成字体 CSS");
    }
    if (!cjkCoreUnicodeRange) {
        throw new Error("CJK unicode-range 为空，无法生成字体 CSS");
    }
    const generatedCss = createGeneratedCss({
        asciiSubset,
        cjkCoreSubset,
        cjkFullFallback,
        asciiCoreUnicodeRange,
        cjkCoreUnicodeRange,
    });
    fs.writeFileSync(cssOutputPath, generatedCss);

    writeManifestFiles({
        asciiSubset,
        cjkCoreSubset,
        cjkFullFallback,
        asciiCoreUnicodeRange,
        cjkCoreCharsCount: Array.from(cjkChars).length,
        cjkCoreUnicodeRange,
    });

    console.log("✓ 字体资产已重建");
    console.log(
        `  - ASCII 核心: ${asciiSubset.outputFileName} (${formatSize(asciiSubset.bytes)})`,
    );
    console.log(
        `  - CJK 核心: ${cjkCoreSubset.outputFileName} (${formatSize(cjkCoreSubset.bytes)})`,
    );
    console.log(
        `  - CJK 全量: ${cjkFullFallback.outputFileName} (${formatSize(cjkFullFallback.bytes)})`,
    );
    console.log(`  - CSS 清单: ${path.relative(projectRoot, cssOutputPath)}`);
    console.log(
        `  - Runtime Manifest: ${path.relative(projectRoot, runtimeManifestPath)}`,
    );
}

void buildFontAssets().catch((error) => {
    console.error("× 字体资产构建失败:", error);
    process.exit(1);
});
