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
import { permissionRegistry } from "./registry";

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

  it("only SideEffect exposes summary / title / content on presentation", () => {
    const sideP = permissionRegistry.SideEffect.presentation;
    expect(typeof (sideP as { summary?: unknown }).summary).toBe("function");
    expect(typeof (sideP as { title?: unknown }).title).toBe("function");
    expect(typeof (sideP as { content?: unknown }).content).toBe("function");

    const elicitP = permissionRegistry.Elicitation.presentation as unknown as Record<
      string,
      unknown
    >;
    expect(elicitP.summary).toBeUndefined();
    expect(elicitP.title).toBeUndefined();
    expect(elicitP.content).toBeUndefined();

    const planP = permissionRegistry.PlanReview.presentation as unknown as Record<
      string,
      unknown
    >;
    expect(planP.summary).toBeUndefined();
    expect(planP.title).toBeUndefined();
    expect(planP.content).toBeUndefined();
  });
});

// ── decideShellMode ──

describe("presentation.decideShellMode", () => {
  it("SideEffect → pill", () => {
    expect(
      permissionRegistry.SideEffect.presentation.decideShellMode(
        sideEffectRequest(),
      ),
    ).toBe("pill");
  });

  it("Elicitation → panel", () => {
    expect(
      permissionRegistry.Elicitation.presentation.decideShellMode(
        elicitationRequest(),
      ),
    ).toBe("panel");
  });

  it("PlanReview → panel", () => {
    expect(
      permissionRegistry.PlanReview.presentation.decideShellMode(
        planReviewRequest(),
      ),
    ).toBe("panel");
  });
});

describe("presentation metadata", () => {
  it("all kinds expose non-empty focusKey / badgeVariant / iconKey", () => {
    for (const k of ["SideEffect", "Elicitation", "PlanReview"] as const) {
      const p = permissionRegistry[k].presentation;
      expect(p.focusKey.length).toBeGreaterThan(0);
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

// ── SideEffect presentation.summary / title / content ──

describe("SideEffect presentation.summary (PillShell)", () => {
  const req = sideEffectRequest();

  it("bash: returns the command", () => {
    expect(
      permissionRegistry.SideEffect.presentation.summary(req, {
        kind: "bash",
        command: "ls -la",
      }),
    ).toBe("ls -la");
  });

  it("edit/write/read: returns filePath", () => {
    expect(
      permissionRegistry.SideEffect.presentation.summary(req, {
        kind: "edit",
        filePath: "src/foo.ts",
        addedLines: 3,
        removedLines: 1,
      }),
    ).toBe("src/foo.ts");
    expect(
      permissionRegistry.SideEffect.presentation.summary(req, {
        kind: "write",
        filePath: "src/bar.ts",
        charCount: 120,
      }),
    ).toBe("src/bar.ts");
    expect(
      permissionRegistry.SideEffect.presentation.summary(req, {
        kind: "read",
        filePath: "src/baz.ts",
        offset: 10,
        limit: 20,
      }),
    ).toBe("src/baz.ts");
  });

  it("json: falls back to toolName or 'Tool call'", () => {
    expect(
      permissionRegistry.SideEffect.presentation.summary(
        { ...req, toolName: undefined },
        { kind: "json", toolName: undefined, raw: {} },
      ),
    ).toBe("Tool call");
    expect(
      permissionRegistry.SideEffect.presentation.summary(
        { ...req, toolName: "WebFetch" },
        { kind: "json", toolName: "WebFetch", raw: {} },
      ),
    ).toBe("WebFetch");
  });
});

describe("SideEffect presentation.title (PillShell expanded-title slot)", () => {
  it("returns toolName, or 'Tool call' when undefined", () => {
    const req = sideEffectRequest();
    expect(
      permissionRegistry.SideEffect.presentation.title(req, {
        kind: "bash",
        command: "x",
      }),
    ).toBe("Bash");
    expect(
      permissionRegistry.SideEffect.presentation.title(
        { ...req, toolName: undefined },
        { kind: "json", toolName: undefined, raw: {} },
      ),
    ).toBe("Tool call");
  });
});

describe("SideEffect presentation.content (ToolPillContent)", () => {
  const req = sideEffectRequest();

  it("bash: returns the command", () => {
    expect(
      permissionRegistry.SideEffect.presentation.content(req, {
        kind: "bash",
        command: "ls -la",
      }),
    ).toBe("ls -la");
  });

  it("edit/write/read: returns filePath", () => {
    expect(
      permissionRegistry.SideEffect.presentation.content(req, {
        kind: "edit",
        filePath: "src/foo.ts",
        addedLines: 3,
        removedLines: 1,
      }),
    ).toBe("src/foo.ts");
  });

  it("json: returns pretty-printed raw", () => {
    const out = permissionRegistry.SideEffect.presentation.content(req, {
      kind: "json",
      toolName: "WebFetch",
      raw: { url: "https://example.com" },
    });
    expect(JSON.parse(out)).toEqual({ url: "https://example.com" });
    expect(out).toContain("\n"); // pretty-printed
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
  it("matches BubbleShellRoot.vue:44 pill/panel gate", () => {
    expect(
      permissionRegistry.SideEffect.presentation.decideShellMode(
        sideEffectRequest(),
      ),
    ).toBe("pill");
    expect(
      permissionRegistry.Elicitation.presentation.decideShellMode(
        elicitationRequest(),
      ),
    ).toBe("panel");
    expect(
      permissionRegistry.PlanReview.presentation.decideShellMode(
        planReviewRequest(),
      ),
    ).toBe("panel");
  });

  it("SideEffect.allow produces the same shape as PillShell onAllowOnce", () => {
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

  it("PillShell summary parity: bash returns the command (was PillShell.vue:39)", () => {
    const req = sideEffectRequest();
    expect(
      permissionRegistry.SideEffect.presentation.summary(req, {
        kind: "bash",
        command: "ls -la",
      }),
    ).toBe("ls -la");
  });
});