import { describe, it, expect } from "vitest";
import { wrapText } from "./wrapText";

const createMeasureCtx = (charWidth = 10) => ({
  measureText: (text) => ({ width: text.length * charWidth }),
});

describe("wrapText", () => {
  it("returns a single empty line for blank input", () => {
    const ctx = createMeasureCtx();
    expect(wrapText(ctx, "", 1000)).toEqual([""]);
  });

  it("keeps short text on one line when it fits within maxWidth", () => {
    const ctx = createMeasureCtx();
    expect(wrapText(ctx, "hello world", 1000)).toEqual(["hello world"]);
  });

  it("wraps onto multiple lines once maxWidth is exceeded, without losing words", () => {
    const ctx = createMeasureCtx(10);
    const lines = wrapText(ctx, "aaaa bbbb cccc", 90);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("aaaa bbbb cccc");
  });
});
