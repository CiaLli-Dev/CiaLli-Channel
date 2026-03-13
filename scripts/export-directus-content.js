import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirectus, readItems, rest, staticToken } from "@directus/sdk";
import { loadEnv } from "./load-env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function getEnv(name, fallback = "") {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return fallback;
}

function parseBooleanEnv(value, defaultValue = false) {
    if (value === undefined) {
        return defaultValue;
    }
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
        return false;
    }
    return defaultValue;
}

function toYyyyMmDd(input) {
    if (!input) {
        return "";
    }
    const date = input instanceof Date ? input : new Date(String(input));
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function yamlQuote(value) {
    const s = String(value ?? "");
    if (!s) {
        return '""';
    }

    const safe = /^[a-zA-Z0-9_\-./]+$/.test(s) && !s.includes(":");
    if (safe) {
        return s;
    }

    return JSON.stringify(s);
}

function yamlInlineArray(values) {
    const arr = Array.isArray(values) ? values : [];
    return `[${arr.map((v) => JSON.stringify(String(v))).join(", ")}]`;
}

function normalizeContentPath(p) {
    const raw = String(p ?? "")
        .replaceAll("\\", "/")
        .trim();
    const noLeading = raw.replace(/^\/+/, "");
    const withIndex = noLeading.endsWith("/")
        ? `${noLeading}index.md`
        : noLeading;
    const withExt = path.posix.extname(withIndex)
        ? withIndex
        : `${withIndex}.md`;
    const normalized = path.posix.normalize(withExt);

    if (!normalized || normalized === "." || normalized.startsWith("../")) {
        throw new Error(`Invalid content_path: ${p}`);
    }

    return normalized;
}

function safeResolveUnder(baseDir, relativePosixPath) {
    const rel = String(relativePosixPath).replaceAll("\\", "/");
    const resolved = path.resolve(baseDir, rel);
    const baseResolved = path.resolve(baseDir);

    if (
        resolved !== baseResolved &&
        !resolved.startsWith(`${baseResolved}${path.sep}`)
    ) {
        throw new Error(
            `Refusing to write outside content dir: ${relativePosixPath}`,
        );
    }

    return resolved;
}

function createDirectusClient(baseUrl, token) {
    return createDirectus(baseUrl).with(staticToken(token)).with(rest());
}

async function fetchAllItems({ directus, collection, filter }) {
    const items = [];
    const limit = 100;
    let offset = 0;

    while (true) {
        const page = await directus.request(
            readItems(collection, {
                filter,
                limit,
                offset,
                fields: ["*"],
            }),
        );
        items.push(...page);

        if (page.length < limit) {
            break;
        }
        offset += limit;
    }

    return items;
}

function buildPostFrontmatter(post) {
    const lines = ["---"];

    lines.push(`title: ${yamlQuote(post.title ?? "")}`);

    const published = toYyyyMmDd(post.published);
    if (!published) {
        throw new Error(
            `Post is missing valid published date: ${post?.content_path ?? "(unknown)"}`,
        );
    }
    lines.push(`published: ${published}`);

    const updated = toYyyyMmDd(post.updated);
    if (updated) {
        lines.push(`updated: ${updated}`);
    }

    lines.push(`draft: ${Boolean(post.draft)}`);

    if (post.description) {
        lines.push(`description: ${yamlQuote(post.description)}`);
    }
    if (post.image) {
        lines.push(`image: ${yamlQuote(post.image)}`);
    }

    const tagsValue =
        typeof post.tags === "string"
            ? (() => {
                  try {
                      return JSON.parse(post.tags);
                  } catch {
                      return [];
                  }
              })()
            : post.tags;
    if (Array.isArray(tagsValue) && tagsValue.length > 0) {
        lines.push(`tags: ${yamlInlineArray(tagsValue)}`);
    } else {
        lines.push("tags: []");
    }

    if (
        post.category !== null &&
        post.category !== undefined &&
        String(post.category).trim()
    ) {
        lines.push(`category: ${yamlQuote(String(post.category).trim())}`);
    }

    if (post.lang) {
        lines.push(`lang: ${yamlQuote(post.lang)}`);
    }

    lines.push(`pinned: ${Boolean(post.pinned)}`);

    if (post.comment !== undefined) {
        lines.push(`comment: ${Boolean(post.comment)}`);
    }

    if (
        post.priority !== undefined &&
        post.priority !== null &&
        String(post.priority).trim() !== ""
    ) {
        const num = Number(post.priority);
        if (!Number.isNaN(num)) {
            lines.push(`priority: ${num}`);
        }
    }

    if (post.author) {
        lines.push(`author: ${yamlQuote(post.author)}`);
    }
    if (post.sourceLink) {
        lines.push(`sourceLink: ${yamlQuote(post.sourceLink)}`);
    }
    if (post.licenseName) {
        lines.push(`licenseName: ${yamlQuote(post.licenseName)}`);
    }
    if (post.licenseUrl) {
        lines.push(`licenseUrl: ${yamlQuote(post.licenseUrl)}`);
    }

    if (post.encrypted) {
        lines.push(`encrypted: ${Boolean(post.encrypted)}`);
    }
    if (post.password) {
        lines.push(`password: ${yamlQuote(post.password)}`);
    }

    if (post.alias) {
        lines.push(`alias: ${yamlQuote(post.alias)}`);
    }
    if (post.permalink) {
        lines.push(`permalink: ${yamlQuote(post.permalink)}`);
    }

    lines.push("---");
    return lines.join("\n");
}

async function writeFileEnsuringDir(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
}

async function ensureMarkerFile(contentDir, info) {
    const markerPath = path.join(contentDir, ".directus-export.json");
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(markerPath, JSON.stringify(info, null, 2), "utf-8");
    return markerPath;
}

async function canClean(contentDir) {
    const markerPath = path.join(contentDir, ".directus-export.json");
    try {
        await fs.stat(markerPath);
        return true;
    } catch {
        return false;
    }
}

async function rmDirIfExists(dirPath) {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
        // ignore
    }
}

export async function exportDirectusContent(options = {}) {
    loadEnv();

    const baseUrl = options.directusUrl ?? getEnv("DIRECTUS_URL");
    const token = options.staticToken ?? getEnv("DIRECTUS_STATIC_TOKEN");

    if (!baseUrl || !token) {
        throw new Error(
            "Missing DIRECTUS_URL or DIRECTUS_STATIC_TOKEN. Refusing to export.",
        );
    }

    const contentDir = options.contentDir ?? path.join(rootDir, "content");

    const includeDrafts = parseBooleanEnv(
        options.includeDrafts ?? process.env.DIRECTUS_EXPORT_INCLUDE_DRAFTS,
        false,
    );
    const clean = parseBooleanEnv(
        options.clean ?? process.env.DIRECTUS_EXPORT_CLEAN,
        false,
    );

    const postsCollection =
        options.postsCollection ?? getEnv("DIRECTUS_POSTS_COLLECTION", "posts");
    const specCollection =
        options.specCollection ??
        getEnv("DIRECTUS_SPEC_COLLECTION", "spec_pages");

    console.log("Using Directus content export mode");
    console.log(`Directus: ${baseUrl}`);
    console.log(`Content dir: ${contentDir}`);
    console.log(`Include drafts: ${includeDrafts}`);
    console.log(`Clean output: ${clean}`);

    const postsDir = path.join(contentDir, "posts");
    const specDir = path.join(contentDir, "spec");
    const directus = createDirectusClient(baseUrl, token);

    if (clean) {
        const allowed = await canClean(contentDir);
        if (!allowed) {
            console.warn(
                "DIRECTUS_EXPORT_CLEAN is enabled but marker file is missing; skipping clean to avoid data loss.",
            );
        } else {
            await rmDirIfExists(postsDir);
            await rmDirIfExists(specDir);
        }
    }

    // 确保目录存在
    await fs.mkdir(postsDir, { recursive: true });
    await fs.mkdir(specDir, { recursive: true });

    const postsFilter = includeDrafts ? undefined : { draft: { _eq: false } };
    const posts = await fetchAllItems({
        directus,
        collection: postsCollection,
        filter: postsFilter,
    });

    console.log(`Fetched posts: ${posts.length}`);

    let writtenPosts = 0;
    for (const post of posts) {
        const contentPath = normalizeContentPath(post.content_path);
        const outputPath = safeResolveUnder(postsDir, contentPath);

        const frontmatter = buildPostFrontmatter(post);
        const body = String(post.body_markdown ?? "");
        const content = `${frontmatter}\n\n${body}\n`;

        await writeFileEnsuringDir(outputPath, content);
        writtenPosts++;
    }
    console.log(`Wrote posts: ${writtenPosts}`);

    const specs = await fetchAllItems({
        directus,
        collection: specCollection,
        filter: undefined,
    });

    console.log(`Fetched spec pages: ${specs.length}`);

    let writtenSpecs = 0;
    for (const page of specs) {
        const contentPath = normalizeContentPath(page.content_path);
        const outputPath = safeResolveUnder(specDir, contentPath);

        const body = String(page.body_markdown ?? "");
        await writeFileEnsuringDir(outputPath, `${body}\n`);
        writtenSpecs++;
    }
    console.log(`Wrote spec pages: ${writtenSpecs}`);

    const markerPath = await ensureMarkerFile(contentDir, {
        exportedAt: new Date().toISOString(),
        directusUrl: baseUrl,
        postsCollection,
        specCollection,
        includeDrafts,
    });
    console.log(`Marker file: ${markerPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    exportDirectusContent().catch((error) => {
        console.error("Directus export failed:", error?.message || error);
        process.exitCode = 1;
    });
}
