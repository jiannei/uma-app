import { describe, it, expect } from "vitest";
import { useToolColor } from "./useToolColor";

describe("useToolColor", () => {
  it("returns Bash colors for Bash", () => {
    const { dotClass, pillClass } = useToolColor("Bash");
    expect(dotClass).toContain("orange");
    expect(pillClass).toContain("orange");
  });

  it("returns Edit colors for Edit", () => {
    const { dotClass } = useToolColor("Edit");
    expect(dotClass).toContain("emerald");
  });

  it("returns fallback colors for unknown tool", () => {
    const { dotClass, pillClass } = useToolColor("UnknownTool");
    expect(dotClass).toContain("zinc");
    expect(pillClass).toContain("zinc");
  });

  it("returns fallback colors for undefined", () => {
    const { dotClass } = useToolColor(undefined);
    expect(dotClass).toContain("zinc");
  });

  it("is case-insensitive (normalizes to capitalized)", () => {
    const { dotClass: lower } = useToolColor("bash");
    const { dotClass: upper } = useToolColor("Bash");
    expect(lower).toBe(upper);
  });
});