// src/permission/registry.ts — Cross-kind dispatch for PermissionRequest.
//
// Single source of truth for how each `PermissionKind` is presented, how
// the bubble assembles the user reply into a canonical
// `PermissionDecision`, how the SideEffectRender sub-shape is
// rendered (pill-shell summary, expanded title, expanded content), and
// how a SideEffect toolName + toolInput payload is classified into a
// SideEffectRender in the first place.
//
// ADR-0018 vocabulary:
//   - ShellMode → 'pill' | 'panel'
//   - SideEffectRenderKind → 'bash' | 'edit' | 'write' | 'read' | 'json'
//   - kind entry: { presentation, reply }
//   - presentation is conditional on K: SideEffect adds summary/title/content
//
// ADR-0018 Stage B PR4: the `SideEffectRender` discriminated union and
// the `classifySideEffect` function that used to live in
// `src/bubble/format-side-effect.ts` moved here. The bubble-side file
// had no other consumer after Stages PR1–PR3 migrated PillShell and
// ToolPillContent to `lookupSideEffectRender`; the move is what lets
// the registry own the full SideEffect sub-shape pipeline (classify →
// present → reply) in one module.

import type {
  ElicitationRequest,
  PermissionDecision,
  PermissionKind,
  PermissionRequest,
  PlanReviewRequest,
  SideEffectRequest,
  PermissionUpdateEntry,
} from "../types/permission";

// ── SideEffectRender + classifySideEffect (moved from
// src/bubble/format-side-effect.ts; helper `firstStringValue` moved
// from src/bubble/format-string.ts which had no other consumers after
// PR4) ──

export type SideEffectRender =
  | { kind: "bash"; command: string }
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
 * `names`, trimmed. Used for explicit field-name fallbacks
 * (`description`, `file_path`, etc.). */
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

/** Classify a SideEffect toolName + toolInput into a SideEffectRender
 * variant. The classifier is the only thing that knows which tool
 * names map to which render kind; consumers call
 * `lookupSideEffectRender(req)` and treat the result as an opaque
 * `SideEffectRender`. */
function classifySideEffect(
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
      if (command) return { kind: "bash", command };
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

// ── 公开类型 ──

export type ShellMode = "pill" | "panel";
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
  /** SideEffect → 'pill'; Elicitation / PlanReview → 'panel'. The
   * ADR-0018 Q1 noted that a future enhancement may make this payload-
   * dependent (e.g. long bash → panel). Stage A is intentionally
   * kind-only to match the existing BubbleShellRoot.vue:44 logic. */
  decideShellMode(req: RequestByKind<K>): ShellMode;
  /** First-focus element key. Consumer maps this to a DOM ref. */
  focusKey: string;
  /** StoresPanel badge color. */
  badgeVariant: BadgeVariant;
  /** StoresPanel icon identifier. */
  iconKey: string;
  /** Per-kind detail string (used by StoresPanel; replaces the
   * StoresPanel.vue:35-53 `detail()` switch). */
  detail(req: RequestByKind<K>): string;
}

/** SideEffect adds pill-shell summary/title (computed from the render
 * returned by lookupSideEffectRender) and expanded content preview. */
interface SideEffectPresentation extends BasePresentation<"SideEffect"> {
  summary(req: SideEffectRequest, render: SideEffectRender): string;
  title(req: SideEffectRequest, render: SideEffectRender): string;
  content(req: SideEffectRequest, render: SideEffectRender): string;
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

// ── 私有辅助 ──

function baseDecision(
  requestId: string,
  behavior: "allow" | "deny",
): PermissionDecision {
  return { requestId, behavior };
}

function sideEffectSummary(
  req: SideEffectRequest,
  r: SideEffectRender,
): string {
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

function sideEffectTitle(
  req: SideEffectRequest,
  _r: SideEffectRender,
): string {
  return req.toolName ?? "Tool call";
}

function sideEffectContent(
  _req: SideEffectRequest,
  r: SideEffectRender,
): string {
  if (r.kind === "bash") return r.command;
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

// ── 三 kind 的 entry ──

const sideEffectEntry: KindEntry<"SideEffect"> = {
  presentation: {
    decideShellMode: () => "pill",
    focusKey: "allow-once",
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
    decideShellMode: () => "panel",
    focusKey: "submit",
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
    decideShellMode: () => "panel",
    focusKey: "approve",
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

// ── 主注册表 ──

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

/** Convenience helper: classify a SideEffect's payload into a
 * SideEffectRender (delegates to classifySideEffect). Consumers call
 * this once and pass the render to
 * `permissionRegistry.SideEffect.presentation.{summary,title,content}(req, render)`. */
export function lookupSideEffectRender(
  req: SideEffectRequest,
): SideEffectRender {
  return classifySideEffect(req.toolName, req.toolInput);
}

// Re-export `ElicitationRequest` and `PlanReviewRequest` so consumers
// can pull the request types from this module too.
export type {
  SideEffectRequest,
  ElicitationRequest,
  PlanReviewRequest,
  PermissionDecision,
  PermissionRequest,
  PermissionKind,
};
