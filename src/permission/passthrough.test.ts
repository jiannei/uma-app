import { describe, it, expect } from "vitest";
import { isPassthrough, PASSTHROUGH_TOOLS } from "./pure";

describe("isPassthrough (TS mirror of Rust)", () => {
  it("matches the Rust constant for known tools", () => {
    for (const tool of PASSTHROUGH_TOOLS) {
      expect(isPassthrough(tool)).toBe(true);
    }
  });

  it("returns false for non-passthrough tools", () => {
    expect(isPassthrough("Bash")).toBe(false);
    expect(isPassthrough("Edit")).toBe(false);
    expect(isPassthrough("Read")).toBe(false);
  });

  it("returns false for undefined and empty string", () => {
    expect(isPassthrough(undefined)).toBe(false);
    expect(isPassthrough("")).toBe(false);
  });

  it("is case-sensitive (matches Rust)", () => {
    expect(isPassthrough("taskcreate")).toBe(false);
    expect(isPassthrough("TASKCREATE")).toBe(false);
  });
});