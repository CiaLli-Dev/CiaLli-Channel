/* 此文件由 scripts/build-font-assets.js 自动生成，请勿手改 */
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

export const generatedFontManifest: GeneratedFontManifest = {
  "cssHref": "/assets/font/generated-fonts.css",
  "preloadFonts": [
    {
      "href": "/assets/font/ascii-core.0739f307a5e7.woff2",
      "type": "font/woff2",
      "crossorigin": "anonymous",
      "fetchpriority": "high"
    },
    {
      "href": "/assets/font/cjk-core.447aca0b715c.woff2",
      "type": "font/woff2",
      "crossorigin": "anonymous",
      "fetchpriority": "high"
    }
  ],
  "deferredFonts": [
    {
      "href": "/assets/font/cjk-fallback-full.62ffccb9760f.woff2",
      "type": "font/woff2",
      "crossorigin": "anonymous",
      "fetchpriority": "low"
    }
  ],
  "deferredWarmup": {
    "enabled": true,
    "trigger": "window-load-idle",
    "sessionKey": "cialli.font.deferred-warmup.v1",
    "fetchpriority": "low"
  }
};
