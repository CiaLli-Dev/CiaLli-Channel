import * as fs from "node:fs";

import type { APIContext, GetStaticPaths } from "astro";
import satori from "satori";
import sharp from "sharp";

import { readMany } from "@/server/directus/client";
import { getResolvedSiteSettings } from "@/server/site-settings/service";
import type { JsonObject } from "@/types/json";

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type FontStyle = "normal" | "italic";

interface FontOptions {
    data: Buffer | ArrayBuffer;
    name: string;
    weight?: Weight;
    style?: FontStyle;
    lang?: string;
}

type OgPost = {
    slug: string;
    title: string;
    summary: string | null;
    date_updated: string | null;
    date_created: string | null;
};

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
    const rows = await readMany("app_articles", {
        filter: {
            _and: [
                { status: { _eq: "published" } },
                { is_public: { _eq: true } },
            ],
        } as JsonObject,
        sort: ["-date_updated", "-date_created"],
        limit: 1000,
        fields: ["slug", "title", "summary", "date_updated", "date_created"],
    });

    return rows
        .filter(
            (
                post,
            ): post is typeof post & {
                slug: string;
            } => Boolean(post.slug),
        )
        .map((post) => ({
            params: { slug: post.slug },
            props: {
                post: {
                    slug: post.slug,
                    title: post.title,
                    summary: post.summary,
                    date_updated: post.date_updated,
                    date_created: post.date_created,
                } satisfies OgPost,
            },
        }));
};

let fontCache: { regular: Buffer | null; bold: Buffer | null } | null = null;

function loadLocalOgFonts(): { regular: Buffer | null; bold: Buffer | null } {
    const readLocalFont = (path: string): Buffer | null => {
        try {
            return fs.readFileSync(path);
        } catch (error) {
            console.warn(`[og] failed to read local font: ${path}`, error);
            return null;
        }
    };

    return {
        regular: readLocalFont(
            "./node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff",
        ),
        bold: readLocalFont(
            "./node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff",
        ),
    };
}

async function fetchNotoSansSCFonts(): Promise<{
    regular: Buffer | null;
    bold: Buffer | null;
}> {
    if (fontCache) {
        return fontCache;
    }

    try {
        const cssResp = await fetch(
            "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap",
        );
        if (!cssResp.ok) {
            throw new Error("Failed to fetch Google Fonts CSS");
        }
        const cssText = await cssResp.text();

        const getUrlForWeight = (weight: number): string | null => {
            const blockRe = new RegExp(
                `@font-face\\s*{[^}]*font-weight:\\s*${weight}[^}]*}`,
                "g",
            );
            const match = cssText.match(blockRe);
            if (!match || match.length === 0) {
                return null;
            }
            const urlMatch = match[0].match(/url\((https:[^)]+)\)/);
            return urlMatch ? urlMatch[1] : null;
        };

        const regularUrl = getUrlForWeight(400);
        const boldUrl = getUrlForWeight(700);

        if (!regularUrl || !boldUrl) {
            console.warn(
                "Could not find font urls in Google Fonts CSS; falling back to local fonts.",
            );
            fontCache = loadLocalOgFonts();
            return fontCache;
        }

        const [rResp, bResp] = await Promise.all([
            fetch(regularUrl),
            fetch(boldUrl),
        ]);
        if (!rResp.ok || !bResp.ok) {
            console.warn(
                "Failed to download font files from Google; falling back to local fonts.",
            );
            fontCache = loadLocalOgFonts();
            return fontCache;
        }

        const rBuf = Buffer.from(await rResp.arrayBuffer());
        const bBuf = Buffer.from(await bResp.arrayBuffer());

        fontCache = { regular: rBuf, bold: bBuf };
        return fontCache;
    } catch (error) {
        console.warn("Error fetching fonts:", error);
        // 大陆构建环境可能无法访问 Google 字体，回退到仓库内置字体以保证 build 稳定。
        fontCache = loadLocalOgFonts();
        return fontCache;
    }
}

function resolvePublishedDate(post: OgPost, timeZone: string): string {
    const raw = post.date_updated || post.date_created;
    const date = raw ? new Date(raw) : new Date();
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return date.toLocaleDateString("en-US", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function resolveLocalAssetPath(
    source: string | null | undefined,
    fallbackPath: string,
): string {
    const input = String(source || "").trim();
    if (!input) {
        return fallbackPath;
    }
    if (input.startsWith("assets/")) {
        return `./src/${input}`;
    }
    if (
        input.startsWith("/assets/") ||
        input.startsWith("/favicon/") ||
        input.startsWith("/images/")
    ) {
        return `./public${input}`;
    }
    return fallbackPath;
}

function loadImageAsBase64(path: string): string {
    const buffer = fs.readFileSync(path);
    return `data:image/png;base64,${buffer.toString("base64")}`;
}

type OgTemplateParams = {
    post: OgPost;
    siteTitle: string;
    profileName: string;
    avatarBase64: string;
    iconBase64: string;
    pubDate: string;
    primaryColor: string;
    textColor: string;
    subtleTextColor: string;
    backgroundColor: string;
};

function buildOgTemplate(p: OgTemplateParams): object {
    const description = p.post.summary;
    return {
        type: "div",
        props: {
            style: {
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                backgroundColor: p.backgroundColor,
                fontFamily:
                    '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                padding: "60px",
            },
            children: [
                buildOgHeader(p.iconBase64, p.siteTitle, p.subtleTextColor),
                buildOgBody(
                    p.post.title,
                    description,
                    p.primaryColor,
                    p.textColor,
                    p.subtleTextColor,
                ),
                buildOgFooter(
                    p.avatarBase64,
                    p.profileName,
                    p.pubDate,
                    p.textColor,
                    p.subtleTextColor,
                ),
            ],
        },
    };
}

function buildOgHeader(
    iconBase64: string,
    siteTitle: string,
    subtleTextColor: string,
): object {
    return {
        type: "div",
        props: {
            style: {
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "20px",
            },
            children: [
                {
                    type: "img",
                    props: {
                        src: iconBase64,
                        width: 48,
                        height: 48,
                        style: { borderRadius: "10px" },
                    },
                },
                {
                    type: "div",
                    props: {
                        style: {
                            fontSize: "36px",
                            fontWeight: 600,
                            color: subtleTextColor,
                        },
                        children: siteTitle,
                    },
                },
            ],
        },
    };
}

function buildOgBody(
    title: string,
    description: string | null,
    primaryColor: string,
    textColor: string,
    subtleTextColor: string,
): object {
    return {
        type: "div",
        props: {
            style: {
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                flexGrow: 1,
                gap: "20px",
            },
            children: [
                {
                    type: "div",
                    props: {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                            {
                                type: "div",
                                props: {
                                    style: {
                                        width: "10px",
                                        height: "68px",
                                        backgroundColor: primaryColor,
                                        borderRadius: "6px",
                                        marginTop: "14px",
                                    },
                                },
                            },
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: "72px",
                                        fontWeight: 700,
                                        lineHeight: 1.2,
                                        color: textColor,
                                        marginLeft: "25px",
                                        display: "-webkit-box",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        lineClamp: 3,
                                        WebkitLineClamp: 3,
                                        WebkitBoxOrient: "vertical",
                                    },
                                    children: title,
                                },
                            },
                        ],
                    },
                },
                description
                    ? {
                          type: "div",
                          props: {
                              style: {
                                  fontSize: "32px",
                                  lineHeight: 1.5,
                                  color: subtleTextColor,
                                  paddingLeft: "35px",
                                  display: "-webkit-box",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  lineClamp: 2,
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                              },
                              children: description,
                          },
                      }
                    : null,
            ].filter(Boolean),
        },
    };
}

function buildOgFooter(
    avatarBase64: string,
    profileName: string,
    pubDate: string,
    textColor: string,
    subtleTextColor: string,
): object {
    return {
        type: "div",
        props: {
            style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
            },
            children: [
                {
                    type: "div",
                    props: {
                        style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "20px",
                        },
                        children: [
                            {
                                type: "img",
                                props: {
                                    src: avatarBase64,
                                    width: 60,
                                    height: 60,
                                    style: { borderRadius: "50%" },
                                },
                            },
                            {
                                type: "div",
                                props: {
                                    style: {
                                        fontSize: "28px",
                                        fontWeight: 600,
                                        color: textColor,
                                    },
                                    children: profileName,
                                },
                            },
                        ],
                    },
                },
                {
                    type: "div",
                    props: {
                        style: { fontSize: "28px", color: subtleTextColor },
                        children: pubDate,
                    },
                },
            ],
        },
    };
}

function buildFontList(
    fontRegular: Buffer | null,
    fontBold: Buffer | null,
): FontOptions[] {
    const fonts: FontOptions[] = [];
    if (fontRegular) {
        fonts.push({
            name: "Noto Sans SC",
            data: fontRegular,
            weight: 400,
            style: "normal",
        });
    }
    if (fontBold) {
        fonts.push({
            name: "Noto Sans SC",
            data: fontBold,
            weight: 700,
            style: "normal",
        });
    }
    return fonts;
}

export async function GET({
    props,
}: APIContext<{ post: OgPost }>): Promise<Response> {
    const { post } = props;
    const resolvedSiteSettings = await getResolvedSiteSettings();
    const settings = resolvedSiteSettings.settings;
    const system = resolvedSiteSettings.system;
    const { regular: fontRegular, bold: fontBold } =
        await fetchNotoSansSCFonts();

    const avatarBase64 = loadImageAsBase64(
        resolveLocalAssetPath(
            settings.profile.avatar,
            "./src/assets/images/avatar.webp",
        ),
    );
    const iconBase64 = loadImageAsBase64(
        resolveLocalAssetPath(
            settings.site.favicon[0]?.src,
            "./public/favicon/favicon.ico",
        ),
    );

    const hue = system.themeColor.hue;
    const template = buildOgTemplate({
        post,
        siteTitle: settings.site.title,
        profileName: settings.profile.name,
        avatarBase64,
        iconBase64,
        pubDate: resolvePublishedDate(post, system.timeZone),
        primaryColor: `hsl(${hue}, 90%, 65%)`,
        textColor: "hsl(0, 0%, 95%)",
        subtleTextColor: `hsl(${hue}, 10%, 75%)`,
        backgroundColor: `hsl(${hue}, 15%, 12%)`,
    });

    const svg = await satori(template, {
        width: 1200,
        height: 630,
        fonts: buildFontList(fontRegular, fontBold),
    });

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    return new Response(new Uint8Array(png), {
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
