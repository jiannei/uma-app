import { describe, it, expect } from "vitest";
import {
  normalizePermissionSuggestions,
  MAX_PERMISSION_SUGGESTIONS,
} from "./__test__";
import type { PermissionUpdateEntry } from "@/types/permission";

function addRules(
  behavior: "allow" | "deny" | "ask",
  rules: { toolName: string; ruleContent?: string }[],
  destination: "session" | "localSettings" | "projectSettings" | "userSettings" = "userSettings",
): PermissionUpdateEntry {
  return {
    type: "addRules",
    destination,
    behavior,
    rules,
  };
}

describe("normalizePermissionSuggestions (TS mirror of Rust)", () => {
  it("merges consecutive addRules with same destination + behavior", () => {
    const raw = [
      addRules("allow", [{ toolName: "Bash", ruleContent: "echo *" }]),
      addRules("allow", [{ toolName: "Bash", ruleContent: "ls *" }]),
    ];
    const out = normalizePermissionSuggestions(raw);
    expect(out).toHaveLength(1);
    if (out[0].type === "addRules") {
      expect(out[0].rules).toHaveLength(2);
    } else {
      expect.fail("expected addRules");
    }
  });

  it("does not merge across destinations", () => {
    const raw = [
      addRules("allow", [{ toolName: "Bash", ruleContent: "echo *" }], "userSettings"),
      addRules("allow", [{ toolName: "Bash", ruleContent: "ls *" }], "session"),
    ];
    const out = normalizePermissionSuggestions(raw);
    expect(out).toHaveLength(2);
  });

  it("does not merge across behaviors", () => {
    const raw = [
      addRules("allow", [{ toolName: "Bash", ruleContent: "echo *" }]),
      addRules("deny", [{ toolName: "Bash", ruleContent: "ls *" }]),
    ];
    const out = normalizePermissionSuggestions(raw);
    expect(out).toHaveLength(2);
  });

  it("caps at MAX_PERMISSION_SUGGESTIONS", () => {
    // Alternate destinations so consecutive entries don't merge.
    const raw = Array.from({ length: 25 }, (_, i) =>
      addRules(
        "allow",
        [{ toolName: `T${i}`, ruleContent: "x" }],
        i % 2 === 0 ? "userSettings" : "session",
      ),
    );
    const out = normalizePermissionSuggestions(raw);
    expect(out.length).toBe(MAX_PERMISSION_SUGGESTIONS);
  });

  it("passes through non-addRules entries unchanged", () => {
    const raw: PermissionUpdateEntry[] = [
      {
        type: "setMode",
        mode: "acceptEdits",
        destination: "userSettings",
      },
      {
        type: "addDirectories",
        directories: ["/tmp"],
        destination: "userSettings",
      },
    ];
    const out = normalizePermissionSuggestions(raw);
    expect(out).toHaveLength(2);
  });
});