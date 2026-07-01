// src/permission/registry.ts — Cross-kind dispatch for PermissionRequest.
//
// Single source of truth for how each `PermissionKind` is presented,
// how the bubble assembles the user reply into a canonical
// `PermissionDecision`, and how a SideEffect toolName + toolInput
// payload is classified into a SideEffectRender.
//
// The registry exposes TWO surfaces:
//
//   1. Per-kind access: `permissionRegistry.SideEffect.presentation.*`
//      — for kind-specific data (summary text, badge variant, etc.).
//
//   2. Cross-kind dispatch (this module's reason for existing):
//      `decideShellMode(req)` / `buildReply(req, pick)` / `detail(req)`.
//      These are 3 free functions that switch on req.kind and route
//      to the right entry. Before this PR, callers hand-wrote the
//      switch 3 times (BubbleShellRoot x2, StoresPanel x1). Now
//      they all go through here.
//
// ADR-0018 vocabulary:
//   - ShellMode → 'pill' | 'panel'
//   - SideEffectRenderKind → 'bash' | 'edit' | 'write' | 'read' | 'json'
//   - kind entry: { presentation, reply }
//
// Stage B of #5 (this PR's design): the `SideEffectRender`
// discriminated union and the `classifySideEffect` function live
// here; the `lookupSideEffectRender` export is gone — consumers
// see only the opaque presentation methods (summary / title /
// content) which compute the render internally.

import type {
  ElicitationRequest,
  PermissionDecision,
  PermissionKind,
  PermissionRequest,
  PlanReviewRequest,
  SideEffectRequest,
  PermissionUpdateEntry,
} from "../types/permission";

// ── SideEffectRender + classifySideEffect ───────────────────────
//
// Both are exported (re-exported via `__test__/index.ts` for unit tests
// that want to assert the render shape without pulling in the whole
// registry surface). The registry's own presentation helpers call
// classifySideEffect internally and never expose the intermediate render
// to consumers — that's what the `summary / title / content` API on
// `permissionRegistry.SideEffect.presentation` is for.

export type SideEffectRender =
  | { kind: "bash"; command: string; description?: string }
  | {
      kind: "edit";
      filePath: string;
      addedLines: number;
      removedLines: number;
    }
  | { kind: "write"; filePath: string; charCount: number }
  | {
      kind: "read";
      filePath: string;
      offset?: number;
      limit?: number;
    }
  | { kind: "json"; toolName?: string; raw: unknown };

/** Return the first string-typed value in `input` whose key is in
 * `names`, trimmed. */
function firstStringValue(
  input: Record<string, unknown>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function classifySideEffect(
  toolName: string | undefined,
  toolInput: unknown,
): SideEffectRender {
  if (!toolInput || typeof toolInput !== "object") {
    return { kind: "json", toolName, raw: toolInput };
  }
  const input = toolInput as Record<string, unknown>;

  switch (toolName) {
    case "Bash": {
      const command = firstStringValue(input, ["command", "cmd"]);
      if (command) {
        const description = firstStringValue(input, ["description"]);
        return description
          ? { kind: "bash", command, description }
          : { kind: "bash", command };
      }
      break;
    }
    case "Edit":
    case "MultiEdit": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const newString = firstStringValue(input, [
          "new_string",
          "newString",
          "content",
        ]);
        const oldString = firstStringValue(input, [
          "old_string",
          "oldString",
        ]);
        return {
          kind: "edit",
          filePath: path,
          addedLines: newString ? newString.split("\n").length : 0,
          removedLines: oldString ? oldString.split("\n").length : 0,
        };
      }
      break;
    }
    case "Write": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const content = firstStringValue(input, ["content"]);
        return {
          kind: "write",
          filePath: path,
          charCount: content.length,
        };
      }
      break;
    }
    case "Read": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const offset =
          typeof input.offset === "number" ? input.offset : undefined;
        const limit =
          typeof input.limit === "number" ? input.limit : undefined;
        return { kind: "read", filePath: path, offset, limit };
      }
      break;
    }
  }

  return { kind: "json", toolName, raw: input };
}

// ── Public types ────────────────────────────────────────────────

export type BadgeVariant = "warning" | "info" | "success";
export type SideEffectRenderKind = SideEffectRender["kind"];

type RequestByKind<K extends PermissionKind> = Extract<
  PermissionRequest,
  { kind: K }
>;

/** What the user picked (one click context); kind-aware reply() turns
 * this into the canonical PermissionDecision shape per ADR-0017. */
export interface ReplyPick {
  behavior: "allow" | "deny";
  updatedPermissions?: PermissionUpdateEntry[];
  updatedInput?: unknown;
  message?: string;
}

/** Common fields every kind exposes. */
interface BasePresentation<K extends PermissionKind> {
  /** StoresPanel badge color. */
  badgeVariant: BadgeVariant;
  /** StoresPanel icon identifier. */
  iconKey: string;
  /** Per-kind detail string (used by StoresPanel). */
  detail(req: RequestByKind<K>): string;
}

/** SideEffect adds pill-shell summary/title and expanded content
 * preview. Each method internally computes the SideEffectRender
 * from req.toolName + req.toolInput — callers never see the
 * intermediate render. */
interface SideEffectPresentation extends BasePresentation<"SideEffect"> {
  summary(req: SideEffectRequest): string;
  title(req: SideEffectRequest): string;
  content(req: SideEffectRequest): string;
}

/** Elicitation / PlanReview only carry the common fields. */
export type PresentationConfig<K extends PermissionKind> = K extends "SideEffect"
  ? SideEffectPresentation
  : BasePresentation<K>;

export interface KindEntry<K extends PermissionKind> {
  presentation: PresentationConfig<K>;
  /** Build the canonical `PermissionDecision` shape per ADR-0017. */
  reply(req: RequestByKind<K>, pick: ReplyPick): PermissionDecision;
}

// ── Private helpers ─────────────────────────────────────────────

function baseDecision(
  requestId: string,
  behavior: "allow" | "deny",
): PermissionDecision {
  return { requestId, behavior };
}

function sideEffectSummary(req: SideEffectRequest): string {
  const r = classifySideEffect(req.toolName, req.toolInput);
  switch (r.kind) {
    case "bash":
      return r.command;
    case "edit":
    case "write":
    case "read":
      return r.filePath;
    case "json":
      return req.toolName ?? "Tool call";
  }
}

function sideEffectTitle(req: SideEffectRequest): string {
  return req.toolName ?? "Tool call";
}

function sideEffectContent(req: SideEffectRequest): string {
  const r = classifySideEffect(req.toolName, req.toolInput);
  // For Bash: prefer `description` (short, human-readable) when
  // present, fall back to the raw `command`. Mirrors uma-pet's
  // bubble-format.js:67-68 behavior. Claude Code's Bash tool sends
  // both `command` and `description` — the description is what users
  // actually want to see at a glance.
  if (r.kind === "bash") return r.description ?? r.command;
  if (r.kind === "edit" || r.kind === "write" || r.kind === "read") {
    return r.filePath;
  }
  return JSON.stringify(r.raw, null, 2);
}

function sideEffectDetail(req: SideEffectRequest): string {
  const sug = req.permissionSuggestions.length;
  const sugSuffix = sug ? ` · ${sug} suggestion${sug === 1 ? "" : "s"}` : "";
  return `${req.toolName ?? "—"}${sugSuffix}`;
}

function elicitationDetail(req: ElicitationRequest): string {
  const n = req.questions.length;
  return `${n} question${n === 1 ? "" : "s"}`;
}

function planReviewDetail(req: PlanReviewRequest): string {
  const len = req.planContent?.length ?? 0;
  return `plan ${len > 0 ? `${len} chars` : "no content"}`;
}

// ── Three kind entries ──────────────────────────────────────────

const sideEffectEntry: KindEntry<"SideEffect"> = {
  presentation: {
    badgeVariant: "warning",
    iconKey: "tool",
    detail: sideEffectDetail,
    summary: sideEffectSummary,
    title: sideEffectTitle,
    content: sideEffectContent,
  },
  reply(req, pick) {
    const base = baseDecision(req.requestId, pick.behavior);
    if (pick.behavior === "allow" && pick.updatedPermissions) {
      return { ...base, updatedPermissions: pick.updatedPermissions };
    }
    if (pick.behavior === "deny" && pick.message) {
      return { ...base, message: pick.message };
    }
    return base;
  },
};

const elicitationEntry: KindEntry<"Elicitation"> = {
  presentation: {
    badgeVariant: "info",
    iconKey: "ask",
    detail: elicitationDetail,
  },
  reply(req, pick) {
    const base = baseDecision(req.requestId, pick.behavior);
    if (pick.behavior === "allow" && pick.updatedInput !== undefined) {
      return { ...base, updatedInput: pick.updatedInput };
    }
    if (pick.behavior === "deny" && pick.message) {
      return { ...base, message: pick.message };
    }
    return base;
  },
};

const planReviewEntry: KindEntry<"PlanReview"> = {
  presentation: {
    badgeVariant: "info",
    iconKey: "plan",
    detail: planReviewDetail,
  },
  reply(req, pick) {
    const base = baseDecision(req.requestId, pick.behavior);
    if (pick.behavior === "deny" && pick.message) {
      return { ...base, message: pick.message };
    }
    return base;
  },
};

// ── Main registry ──────────────────────────────────────────────

/** Explicit per-kind entries (not a mapped type) so TypeScript narrows
 * `permissionRegistry.SideEffect.presentation` to `SideEffectPresentation`
 * without distributing across the union. */
export const permissionRegistry = {
  SideEffect: sideEffectEntry,
  Elicitation: elicitationEntry,
  PlanReview: planReviewEntry,
} as const satisfies {
  [K in PermissionKind]: KindEntry<K>;
};

// ── Cross-kind dispatch surface ─────────────────────────────────
//
// Two free functions that switch on req.kind and route to the
// right entry. Before this PR, callers hand-wrote these switches
// in BubbleShellRoot.vue and StoresPanel.vue. Now every cross-kind
// call goes through here. (Shell-mode dispatch was dropped when
// PillShell + PanelShell collapsed into UnifiedBubbleCard — see
// the bubble-display-design spec.)

/** Build the canonical PermissionDecision from a user pick. */
export function buildReply(
  req: PermissionRequest,
  pick: ReplyPick,
): PermissionDecision {
  switch (req.kind) {
    case "SideEffect":
      return permissionRegistry.SideEffect.reply(req, pick);
    case "Elicitation":
      return permissionRegistry.Elicitation.reply(req, pick);
    case "PlanReview":
      return permissionRegistry.PlanReview.reply(req, pick);
  }
}

/** Per-kind detail string for the StoresPanel. */
export function detail(req: PermissionRequest): string {
  switch (req.kind) {
    case "SideEffect":
      return permissionRegistry.SideEffect.presentation.detail(req);
    case "Elicitation":
      return permissionRegistry.Elicitation.presentation.detail(req);
    case "PlanReview":
      return permissionRegistry.PlanReview.presentation.detail(req);
  }
}

// Re-export request types so consumers can pull them from this module too.
export type {
  SideEffectRequest,
  ElicitationRequest,
  PlanReviewRequest,
  PermissionDecision,
  PermissionRequest,
  PermissionKind,
};

// ── Decision builder helpers ───────────────────────────────────
//
// Convenience wrappers for the common decision shapes. Each helper
// returns a partial PermissionDecision; the caller fills in requestId.

/** PlanReview reject with feedback message. */
export function buildPlanFeedbackDecision(
  requestId: string,
  feedback: string,
): PermissionDecision {
  return {
    requestId,
    behavior: "deny",
    message: feedback,
  };
}

/** "Deny and go to terminal" — PlanReview/Elicitation shortcut. */
export function buildDenyAndFocusDecision(
  requestId: string,
): PermissionDecision {
  return {
    requestId,
    behavior: "deny",
    message: "User chose to handle in terminal",
  };
}