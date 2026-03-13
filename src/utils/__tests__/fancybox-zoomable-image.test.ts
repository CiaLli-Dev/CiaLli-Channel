import { describe, expect, it } from "vitest";

import {
    buildFancyboxZoomableImageTpl,
    resolveFancyboxSlideImageRequestAttributes,
} from "@/utils/fancybox-zoomable-image";

describe("buildFancyboxZoomableImageTpl", () => {
    it("会把放大层所需的 referrer 与 cors 属性写入模板", () => {
        const tpl = buildFancyboxZoomableImageTpl({
            src: "https://example.com/image.png",
            alt: "示例图",
            referrerPolicy: "no-referrer",
            crossOrigin: "anonymous",
        });

        expect(tpl).toContain('data-lazy-src="https://example.com/image.png"');
        expect(tpl).toContain('alt="示例图"');
        expect(tpl).toContain('referrerpolicy="no-referrer"');
        expect(tpl).toContain('crossorigin="anonymous"');
    });

    it("会回退读取缩略图上的镜像属性", () => {
        const tpl = buildFancyboxZoomableImageTpl({
            src: "https://example.com/image.png",
            thumbEl: {
                getAttribute: (name) =>
                    ({
                        "data-referrer-policy": "no-referrer",
                    })[name] ?? null,
            },
        });

        expect(tpl).toContain('referrerpolicy="no-referrer"');
        expect(tpl).not.toContain("crossorigin=");
    });

    it("无外链策略时不输出多余属性", () => {
        const tpl = buildFancyboxZoomableImageTpl({
            src: "/api/v1/public/assets/demo",
            alt: "站内图",
        });

        expect(tpl).toContain('data-lazy-src="/api/v1/public/assets/demo"');
        expect(tpl).not.toContain("referrerpolicy=");
        expect(tpl).not.toContain("crossorigin=");
    });

    it("会回退读取缩略图元素上的外链属性", () => {
        expect(
            resolveFancyboxSlideImageRequestAttributes({
                thumbEl: {
                    getAttribute: (name) =>
                        ({
                            referrerpolicy: "no-referrer",
                            crossorigin: "anonymous",
                        })[name] ?? null,
                },
            }),
        ).toEqual({
            referrerPolicy: "no-referrer",
            crossOrigin: "anonymous",
        });
    });
});
