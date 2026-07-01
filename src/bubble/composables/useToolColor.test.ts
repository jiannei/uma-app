import { describe, it, expect } from "vitest";
import { useToolColor } from "./useToolColor";

describe("useToolColor", () => {
  it("returns Bash hex + matching dot class", () => {
    const { pillHex, dotClass } = useToolColor("Bash");
    expect(pillHex).toBe("#d97757");
    expect(dotClass).toContain("orange");
  });

  it("returns Edit hex + matching dot class", () => {
    const { pillHex, dotClass } = useToolColor("Edit");
    expect(pillHex).toBe("#5b8dd9");
    expect(dotClass).toContain("blue");
  });

  it("returns fallback hex + dot class for unknown tool", () => {
    const { pillHex, dotClass } = useToolColor("UnknownTool");
    expect(pillHex).toBe("#52525b");
    expect(dotClass).toContain("zinc");
  });

  it("returns fallback for undefined", () => {
    const { pillHex } = useToolColor(undefined);
    expect(pillHex).toBe("#52525b");
  });

  it("is case-insensitive (normalizes to capitalized)", () => {
    const { pillHex: lower } = useToolColor("bash");
    const { pillHex: upper } = useToolColor("Bash");
    expect(lower).toBe(upper);
  });

  it("maps Bash and Shell to the same pillHex", () => {
    expect(useToolColor("Bash").pillHex).toBe(useToolColor("Shell").pillHex);
  });

  it("maps Glob and Grep to the same pillHex", () => {
    expect(useToolColor("Glob").pillHex).toBe(useToolColor("Grep").pillHex);
  });
});