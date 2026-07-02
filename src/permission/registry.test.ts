// src/permission/registry.test.ts — Unit tests for the permission
// registry (ADR-0018 Stage A + Stage B). Mirrors the existing
// pure.ts test style: no Vue involved, just direct calls into the
// registry.

import { describe, it, expect } from "vitest";
import type {
  ElicitationRequest,
  PermissionUpdateEntry,
  PlanReviewRequest,
  SideEffectRequest,
} from "../types/permission";
import { permissionRegistry, buildPlanFeedbackDecision, buildDenyAndFocusDecision } from "./registry";

// ── Fixtures ──

const sideEffectRequest = (
  overrides: Partial<SideEffectRequest> = {},
): SideEffectRequest => ({
  kind: "SideEffect",
  requestId: "r-side",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "Bash",
  toolInput: { command: "ls" },
  permissionSuggestions: [],
  ...overrides,
});

const elicitationRequest = (
  overrides: Partial<ElicitationRequest> = {},
): ElicitationRequest => ({
  kind: "Elicitation",
  requestId: "r-elicit",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "AskUserQuestion",
  questions: [
    {
      question: "Which test runner?",
      header: "Tests",
      multiSelect: false,
      options: [
        { label: "Vitest", description: "ESM-native" },
        { label: "Jest", description: "Default" },
      ],
    },
  ],
  ...overrides,
});

const planReviewRequest = (
  overrides: Partial<PlanReviewRequest> = {},
): PlanReviewRequest => ({
  kind: "PlanReview",
  requestId: "r-plan",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "ExitPlanMode",
  planContent: "## Refactor auth\n1. Extract middleware",
  ...overrides,
});

// ── Registry structure ──

describe("permissionRegistry structure", () => {
  it("exposes exactly three kinds", () => {
    expect(Object.keys(permissionRegistry).sort()).toEqual(
      ["Elicitation", "PlanReview", "SideEffect"].sort(),
    );
  });

  it("every kind has presentation + reply", () => {
    for (const k of ["SideEffect", "Elicitation", "PlanReview"] as const) {
      const entry = permissionRegistry[k];
      expect(entry).toBeDefined();
      expect(entry.presentation).toBeDefined();
      expect(typeof entry.reply).toBe("function");
    }
  });

  it("every kind exposes presentation.detail", () => {
    for (const k of ["SideEffect", "Elicitation", "PlanReview"] as const) {
      const p = permissionRegistry[k].presentation;
      expect(typeof p.detail).toBe("function");
    }
  });

  it("only SideEffect exposes classification on presentation", () => {
    const sideP = permissionRegistry.SideEffect.presentation;
    expect(typeof (sideP as { classification?: unknown }).classification).toBe(
      "function",
    );

    const elicitP = permissionRegistry.Elicitation.presentation as unknown as Record<
      string,
      unknown
    >;
    expect(elicitP.classification).toBeUndefined();

    const planP = permissionRegistry.PlanReview.presentation as unknown as Record<
      string,
      unknown
    >;
    expect(planP.classification).toBeUndefined();
  });
});

// ── presentation metadata ──

describe("presentation metadata", () => {
  it("all kinds expose non-empty badgeVariant / iconKey", () => {
    for (const k of ["SideEffect", "Elicitation", "PlanReview"] as const) {
      const p = permissionRegistry[k].presentation;
      expect(["warning", "info", "success"]).toContain(p.badgeVariant);
      expect(p.iconKey.length).toBeGreaterThan(0);
    }
  });
});

// ── presentation.detail (StoresPanel) ──

describe("presentation.detail", () => {
  it("SideEffect: toolName + suggestion count", () => {
    expect(
      permissionRegistry.SideEffect.presentation.detail(
        sideEffectRequest({ toolName: "Bash", permissionSuggestions: [] }),
      ),
    ).toBe("Bash");
    expect(
      permissionRegistry.SideEffect.presentation.detail(
        sideEffectRequest({
          toolName: "Bash",
          permissionSuggestions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash" }],
              behavior: "allow",
              destination: "session",
            },
            {
              type: "addRules",
              rules: [{ toolName: "Bash" }],
              behavior: "allow",
              destination: "session",
            },
          ],
        }),
      ),
    ).toBe("Bash · 2 suggestions");
    expect(
      permissionRegistry.SideEffect.presentation.detail(
        sideEffectRequest({
          toolName: "Bash",
          permissionSuggestions: [
            {
              type: "addRules",
              rules: [{ toolName: "Bash" }],
              behavior: "allow",
              destination: "session",
            },
          ],
        }),
      ),
    ).toBe("Bash · 1 suggestion");
    expect(
      permissionRegistry.SideEffect.presentation.detail(
        sideEffectRequest({ toolName: undefined }),
      ),
    ).toBe("—");
  });

  it("Elicitation: question count", () => {
    expect(
      permissionRegistry.Elicitation.presentation.detail(
        elicitationRequest(),
      ),
    ).toBe("1 question");
    expect(
      permissionRegistry.Elicitation.presentation.detail(
        elicitationRequest({
          questions: [
            ...elicitationRequest().questions,
            {
              question: "Second?",
              header: "Other",
              multiSelect: false,
              options: [{ label: "Yes" }, { label: "No" }],
            },
          ],
        }),
      ),
    ).toBe("2 questions");
  });

  it("PlanReview: plan content length", () => {
    expect(
      permissionRegistry.PlanReview.presentation.detail(planReviewRequest()),
    ).toMatch(/^plan \d+ chars$/);
    expect(
      permissionRegistry.PlanReview.presentation.detail(
        planReviewRequest({ planContent: undefined }),
      ),
    ).toBe("plan no content");
    expect(
      permissionRegistry.PlanReview.presentation.detail(
        planReviewRequest({ planContent: "" }),
      ),
    ).toBe("plan no content");
  });
});

// ── SideEffect presentation.classification ──

describe("SideEffect presentation.classification", () => {
  const classify = (req: SideEffectRequest) =>
    permissionRegistry.SideEffect.presentation.classification(req);

  it("bash: returns command, with description when present", () => {
    expect(
      classify(
        sideEffectRequest({
          toolName: "Bash",
          toolInput: { command: "ls -la" },
        }),
      ),
    ).toEqual({ kind: "bash", command: "ls -la" });

    expect(
      classify(
        sideEffectRequest({
          toolName: "Bash",
          toolInput: { command: "ls -la", description: "list files" },
        }),
      ),
    ).toEqual({ kind: "bash", command: "ls -la", description: "list files" });
  });

  it("edit: returns filePath + line counts", () => {
    expect(
      classify(
        sideEffectRequest({
          toolName: "Edit",
          toolInput: {
            file_path: "src/foo.ts",
            new_string: "x\ny\nz",
            old_string: "a\nb",
          },
        }),
      ),
    ).toEqual({
      kind: "edit",
      filePath: "src/foo.ts",
      addedLines: 3,
      removedLines: 2,
    });
  });

  it("write: returns filePath + charCount", () => {
    expect(
      classify(
        sideEffectRequest({
          toolName: "Write",
          toolInput: { file_path: "src/bar.ts", content: "abcdef" },
        }),
      ),
    ).toEqual({ kind: "write", filePath: "src/bar.ts", charCount: 6 });
  });

  it("read: returns filePath + optional offset/limit", () => {
    expect(
      classify(
        sideEffectRequest({
          toolName: "Read",
          toolInput: { file_path: "src/baz.ts" },
        }),
      ),
    ).toEqual({ kind: "read", filePath: "src/baz.ts", offset: undefined, limit: undefined });

    expect(
      classify(
        sideEffectRequest({
          toolName: "Read",
          toolInput: { file_path: "src/baz.ts", offset: 10, limit: 50 },
        }),
      ),
    ).toEqual({ kind: "read", filePath: "src/baz.ts", offset: 10, limit: 50 });
  });

  it("json: falls back for unknown tool or missing input", () => {
    expect(
      classify(sideEffectRequest({ toolName: undefined, toolInput: undefined })),
    ).toEqual({ kind: "json", toolName: undefined, raw: undefined });
    expect(
      classify(
        sideEffectRequest({
          toolName: "WebFetch",
          toolInput: { url: "https://example.com" },
        }),
      ),
    ).toEqual({
      kind: "json",
      toolName: "WebFetch",
      raw: { url: "https://example.com" },
    });
  });
});

// ── reply (kind-aware) ──

describe("SideEffect.reply", () => {
  it("allow once → {behavior: 'allow'}", () => {
    const out = permissionRegistry.SideEffect.reply(
      sideEffectRequest(),
      { behavior: "allow" },
    );
    expect(out).toEqual({ requestId: "r-side", behavior: "allow" });
  });

  it("allow with suggestion → {behavior, updatedPermissions}", () => {
    const rule: PermissionUpdateEntry = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "rm -rf" }],
      behavior: "allow",
      destination: "session",
    };
    const out = permissionRegistry.SideEffect.reply(
      sideEffectRequest(),
      { behavior: "allow", updatedPermissions: [rule] },
    );
    expect(out).toEqual({
      requestId: "r-side",
      behavior: "allow",
      updatedPermissions: [rule],
    });
  });

  it("deny with message → {behavior, message}", () => {
    const out = permissionRegistry.SideEffect.reply(sideEffectRequest(), {
      behavior: "deny",
      message: "skip for now",
    });
    expect(out).toEqual({
      requestId: "r-side",
      behavior: "deny",
      message: "skip for now",
    });
  });

  it("deny without message → {behavior} only (per ADR-0017 message is optional for SideEffect)", () => {
    const out = permissionRegistry.SideEffect.reply(sideEffectRequest(), {
      behavior: "deny",
    });
    expect(out).toEqual({ requestId: "r-side", behavior: "deny" });
  });
});

describe("Elicitation.reply", () => {
  it("submit → {behavior, updatedInput}", () => {
    const answers = { "Which test runner?": "Vitest" };
    const out = permissionRegistry.Elicitation.reply(
      elicitationRequest(),
      { behavior: "allow", updatedInput: answers },
    );
    expect(out).toEqual({
      requestId: "r-elicit",
      behavior: "allow",
      updatedInput: answers,
    });
  });

  it("deny with message → {behavior, message}", () => {
    const out = permissionRegistry.Elicitation.reply(
      elicitationRequest(),
      { behavior: "deny", message: "skip" },
    );
    expect(out).toEqual({
      requestId: "r-elicit",
      behavior: "deny",
      message: "skip",
    });
  });
});

describe("PlanReview.reply", () => {
  it("approve → {behavior: 'allow'}", () => {
    const out = permissionRegistry.PlanReview.reply(
      planReviewRequest(),
      { behavior: "allow" },
    );
    expect(out).toEqual({ requestId: "r-plan", behavior: "allow" });
  });

  it("reject with feedback → {behavior, message}", () => {
    const out = permissionRegistry.PlanReview.reply(planReviewRequest(), {
      behavior: "deny",
      message: "revise step 2",
    });
    expect(out).toEqual({
      requestId: "r-plan",
      behavior: "deny",
      message: "revise step 2",
    });
  });
});

// ── 反漂移（behavior 不漂移的测试） ──

describe("registry ↔ existing bubble behavior", () => {
  it("SideEffect.allow produces the canonical 2-key shape", () => {
    const out = permissionRegistry.SideEffect.reply(sideEffectRequest(), {
      behavior: "allow",
    });
    expect(Object.keys(out).sort()).toEqual(["behavior", "requestId"]);
  });

  it("StoresPanel.detail parity: SideEffect format matches StoresPanel.vue:36-42", () => {
    // StoresPanel used to compute `${toolName ?? "—"}${sugSuffix}` for SideEffect.
    // The registry's detail() must produce identical strings.
    const req = sideEffectRequest({ toolName: "Bash", permissionSuggestions: [] });
    expect(permissionRegistry.SideEffect.presentation.detail(req)).toBe("Bash");
    const reqNoTool = sideEffectRequest({ toolName: undefined });
    expect(permissionRegistry.SideEffect.presentation.detail(reqNoTool)).toBe(
      "—",
    );
  });
});

describe("Decision builder helpers", () => {
  it("buildPlanFeedbackDecision: deny with feedback message", () => {
    const decision = buildPlanFeedbackDecision("req-1", "too aggressive");
    expect(decision).toEqual({
      requestId: "req-1",
      behavior: "deny",
      message: "too aggressive",
    });
  });

  it("buildDenyAndFocusDecision: deny with terminal handoff message", () => {
    const decision = buildDenyAndFocusDecision("req-2");
    expect(decision).toEqual({
      requestId: "req-2",
      behavior: "deny",
      message: "User chose to handle in terminal",
    });
  });
});