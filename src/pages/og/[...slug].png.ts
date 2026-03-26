import * as fs from "node:fs";

import type { APIContext, GetStaticPaths } from "astro";
import satori from "satori";
import sharp from "sharp";

import { readMany } from "@/server/directus/client";
import { withServiceRepositoryContext } from "@/server/repositories/directus/scope";
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
    const rows = await withServiceRepositoryContext(
        async () =>
            await readMany("app_articles", {
                filter: {
                    _and: [
                        { status: { _eq: "published" } },
                        { is_public: { _eq: true } },
                    ],
                } as JsonObject,
                sort: ["-date_updated", "-date_created"],
                limit: 1000,
                fields: [
                    "slug",
                    "title",
                    "summary",
                    "date_updated",
                    "date_created",
                ],
            }),
    );

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

type OgFontPair = {
    regular: Buffer;
    bold: Buffer;
};

type OgFontCache = {
    sc: OgFontPair;
    jp: OgFontPair;
};

let fontCache: OgFontCache | null = null;
const OG_FONT_FETCH_RETRY_COUNT = 3;
const OG_FONT_CDN_URLS = {
    sc: {
        regular:
            "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FrYtHaA.ttf",
        bold: "https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCrYtHaA.ttf",
    },
    jp: {
        regular:
            "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj35zS1g.ttf",
        bold: "https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk35zS1g.ttf",
    },
} as const;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function fetchFontBuffer(url: string): Promise<Buffer> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= OG_FONT_FETCH_RETRY_COUNT; attempt += 1) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch OG font with status ${response.status}.`,
                );
            }
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            lastError = error;
            if (attempt < OG_FONT_FETCH_RETRY_COUNT) {
                // CDN 偶发握手抖动时做短暂重试，避免单次网络闪断打断整次构建。
                await sleep(500 * attempt);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error("fetch failed");
}

async function fetchNotoOgFonts(): Promise<OgFontCache> {
    if (fontCache) {
        return fontCache;
    }

    fontCache = {
        sc: {
            regular: await fetchFontBuffer(OG_FONT_CDN_URLS.sc.regular),
            bold: await fetchFontBuffer(OG_FONT_CDN_URLS.sc.bold),
        },
        jp: {
            regular: await fetchFontBuffer(OG_FONT_CDN_URLS.jp.regular),
            bold: await fetchFontBuffer(OG_FONT_CDN_URLS.jp.bold),
        },
    };
    return fontCache;
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
                fontFamily: '"Noto Sans SC", "Noto Sans JP", sans-serif',
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
    scFonts: OgFontPair,
    jpFonts: OgFontPair,
): FontOptions[] {
    return [
        {
            name: "Noto Sans SC",
            data: scFonts.regular,
            weight: 400,
            style: "normal",
        },
        {
            name: "Noto Sans SC",
            data: scFonts.bold,
            weight: 700,
            style: "normal",
        },
        {
            name: "Noto Sans JP",
            data: jpFonts.regular,
            weight: 400,
            style: "normal",
        },
        {
            name: "Noto Sans JP",
            data: jpFonts.bold,
            weight: 700,
            style: "normal",
        },
    ];
}

export async function GET({
    props,
}: APIContext<{ post: OgPost }>): Promise<Response> {
    const { post } = props;
    const resolvedSiteSettings = await getResolvedSiteSettings();
    const settings = resolvedSiteSettings.settings;
    const system = resolvedSiteSettings.system;
    const { sc: scFonts, jp: jpFonts } = await fetchNotoOgFonts();

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
        fonts: buildFontList(scFonts, jpFonts),
    });

    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    return new Response(new Uint8Array(png), {
        headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
