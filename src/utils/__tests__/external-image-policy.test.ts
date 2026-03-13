import { describe, expect, it } from "vitest";

import {
    normalizeExternalImageRequestAttributes,
    readExternalImageRequestAttributesFromElement,
    resolveExternalImageRequestAttributes,
    toExternalImageDataAttributes,
} from "@/utils/external-image-policy";

describe("resolveExternalImageRequestAttributes", () => {
    it("绝对外链图片统一补 no-referrer", () => {
        expect(
            resolveExternalImageRequestAttributes(
                "https://example.com/image.png",
            ),
        ).toEqual({
            referrerPolicy: "no-referrer",
        });
    });

    it("hdslb 图片追加 anonymous CORS 兼容", () => {
        expect(
            resolveExternalImageRequestAttributes(
                "https://i0.hdslb.com/bfs/archive/demo.png",
            ),
        ).toEqual({
            referrerPolicy: "no-referrer",
            crossOrigin: "anonymous",
        });
    });

    it("站内相对路径不追加外链属性", () => {
        expect(
            resolveExternalImageRequestAttributes("/api/v1/public/assets/demo"),
        ).toEqual({});
        expect(
            resolveExternalImageRequestAttributes("./images/demo.png"),
        ).toEqual({});
    });

    it("blob 与 data 图片不走外链策略", () => {
        expect(
            resolveExternalImageRequestAttributes(
                "blob:https://example.com/preview-image",
            ),
        ).toEqual({});
        expect(
            resolveExternalImageRequestAttributes("data:image/png;base64,AAAA"),
        ).toEqual({});
    });

    it("可导出 Fancybox 复用的 data 属性", () => {
        expect(
            toExternalImageDataAttributes({
                referrerPolicy: "no-referrer",
                crossOrigin: "anonymous",
            }),
        ).toEqual({
            "data-referrer-policy": "no-referrer",
            "data-cross-origin": "anonymous",
        });
    });

    it("可从元素属性读取外链图片请求属性", () => {
        expect(
            readExternalImageRequestAttributesFromElement({
                getAttribute: (name) =>
                    ({
                        "data-referrer-policy": "no-referrer",
                        "data-cross-origin": "anonymous",
                    })[name] ?? null,
            }),
        ).toEqual({
            referrerPolicy: "no-referrer",
            crossOrigin: "anonymous",
        });
    });

    it("会过滤掉不受支持的属性值", () => {
        expect(
            normalizeExternalImageRequestAttributes({
                referrerPolicy: "unsafe-url",
                crossOrigin: "use-credentials",
            }),
        ).toEqual({});
    });
});
