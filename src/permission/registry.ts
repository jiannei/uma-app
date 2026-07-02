// src/permission/registry.ts — Cross-kind dispatch for PermissionRequest.
//
// Single source of truth for how each `PermissionKind` is presented,
// how the bubble assembles the user reply into a canonical
// `PermissionDecision`, and how a SideEffect toolName + toolInput
// payload is classified into a SideEffectRender.
//
// Callers cross the seam via `permissionRegistry[req.kind]`:
//
//   - `permissionRegistry[req.kind].reply(req, pick)` — turn a user
//     click into a canonical `PermissionDecision` (one entry per kind).
//   - `permissionRegistry[req.kind].presentation.detail(req)` —
//     the per-kind detail string for the StoresPanel.
//   - `permissionRegistry.SideEffect.presentation.classification(req)` —
//     the SideEffect-only structured render.
//
// The kind entries are explicit (not a mapped type) so TypeScript
// narrows `permissionRegistry.SideEffect.presentation` to
// `SideEffectPresentation` (with `classification`) without distributing
// across the union.
//
// Pure helpers (passthrough whitelist, suggestion normalization) live
// in `./pure` — this module only owns the kind-routing surface.
//
// ADR-0018 vocabulary:
//   - SideEffectRenderKind → 'bash' | 'edit' | 'write' | 'read' | 'json'
//   - kind entry: { presentation, reply }

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
// Both are exported so unit tests can assert the render shape
// directly. `permissionRegistry.SideEffect.presentation.classification`
// returns the same `SideEffectRender` directly so consumers see one
// opaque value per request.

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

/** SideEffect adds the per-request render classification. */
interface SideEffectPresentation extends BasePresentation<"SideEffect"> {
  /** Classify toolName + toolInput into a structured render. */
  classification(req: SideEffectRequest): SideEffectRender;
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
    classification: (req) => classifySideEffect(req.toolName, req.toolInput),
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
// Each kind entry's `reply` / `presentation.detail` is parameterised
// by its specific request variant (SideEffectRequest etc.), so callers
// can't do `permissionRegistry[req.kind].reply(req, pick)` directly:
// TypeScript can't narrow the union `req: PermissionRequest` to a
// specific variant through an indexed access. The two free functions
// below exist to give TS a `switch (req.kind)` to narrow in — once
// each arm has `req.kind` as a single literal, the call into the
// matching kind entry is type-safe. Logic stays in the kind entries.

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