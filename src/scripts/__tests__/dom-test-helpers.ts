type RectOptions = Partial<
    Pick<DOMRectInit, "x" | "y" | "width" | "height">
> & {
    top?: number;
    left?: number;
};

export function createDomRect(options: RectOptions = {}): DOMRect {
    const width = options.width ?? 0;
    const height = options.height ?? 0;
    const x = options.x ?? options.left ?? 0;
    const y = options.y ?? options.top ?? 0;

    return {
        x,
        y,
        width,
        height,
        top: options.top ?? y,
        left: options.left ?? x,
        right: x + width,
        bottom: y + height,
        toJSON: () => "",
    } as DOMRect;
}

export function setElementRect(
    element: Element,
    options: RectOptions = {},
): void {
    const rect = createDomRect(options);
    Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => rect,
    });
}

export function setElementBoxSize(
    element: Element,
    options: {
        clientWidth?: number;
        clientHeight?: number;
        scrollWidth?: number;
        scrollHeight?: number;
    },
): void {
    if (options.clientWidth !== undefined) {
        Object.defineProperty(element, "clientWidth", {
            configurable: true,
            value: options.clientWidth,
        });
    }
    if (options.clientHeight !== undefined) {
        Object.defineProperty(element, "clientHeight", {
            configurable: true,
            value: options.clientHeight,
        });
    }
    if (options.scrollWidth !== undefined) {
        Object.defineProperty(element, "scrollWidth", {
            configurable: true,
            value: options.scrollWidth,
        });
    }
    if (options.scrollHeight !== undefined) {
        Object.defineProperty(element, "scrollHeight", {
            configurable: true,
            value: options.scrollHeight,
        });
    }
}

export function dispatchPointerEvent(
    target: Element,
    type: string,
    init: PointerEventInit = {},
): PointerEvent {
    const event = new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        ...init,
    });
    target.dispatchEvent(event);
    return event;
}

export function dispatchWheelEvent(
    target: Element,
    init: WheelEventInit = {},
): WheelEvent {
    const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ...init,
    });
    target.dispatchEvent(event);
    return event;
}
