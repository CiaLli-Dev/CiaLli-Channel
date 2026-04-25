import { describe, expect, it } from "vitest";

import { shouldManuallyInsertUsernameInput } from "@/scripts/auth/form-validators";

function makeInputEvent(overrides: Partial<InputEvent> = {}): InputEvent {
    return {
        inputType: "insertText",
        data: "_",
        isComposing: false,
        defaultPrevented: false,
        ...overrides,
    } as unknown as InputEvent;
}

describe("auth form validators", () => {
    it("allows documented username punctuation through the manual input path", () => {
        expect(shouldManuallyInsertUsernameInput(makeInputEvent())).toBe(true);
        expect(
            shouldManuallyInsertUsernameInput(makeInputEvent({ data: "-" })),
        ).toBe(true);
    });

    it("does not manually insert invalid or already handled username input", () => {
        expect(
            shouldManuallyInsertUsernameInput(makeInputEvent({ data: "中" })),
        ).toBe(false);
        expect(
            shouldManuallyInsertUsernameInput(
                makeInputEvent({ isComposing: true }),
            ),
        ).toBe(false);
        expect(
            shouldManuallyInsertUsernameInput(
                makeInputEvent({ defaultPrevented: true }),
            ),
        ).toBe(false);
    });
});
