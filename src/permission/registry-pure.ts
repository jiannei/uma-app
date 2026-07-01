// src/permission/registry-pure.ts — pure functions extracted from
// registry.ts for unit testing without Vue / Tauri runtime.
//
// These functions are re-exported via src/permission/__test__/index.ts
// (the uma-pet "module.exports.__test" pattern). Tests can import
// from __test__ without pulling in the full registry surface.

import type {
  PermissionDecision,
  PermissionRequest,
  PermissionUpdateEntry,
} from "../types/permission";

// ── SideEffect classification ────────────────────────────────────

export type SideEffectRender =
  | { kind: "bash"; command: string }
  | { kind: "edit"; filePath: string }
  | { kind: "write"; filePath: string }
  | { kind: "read"; filePath: string }
  | { kind: "json"; raw: unknown };

/**
 * Classify a SideEffect request into a renderable form.
 * Pure function: no I/O, no Vue, no Tauri.
 */
export function classifySideEffect(
  toolName: string | undefined,
  toolInput: unknown,
): SideEffectRender {
  const input = (toolInput ?? {}) as Record<string, unknown>;
  if (toolName === "Bash" || toolName === "Shell") {
    const command = typeof input.command === "string" ? input.command : "";
    return { kind: "bash", command };
  }
  if (toolName === "Edit") {
    const filePath =
      typeof input.file_path === "string" ? input.file_path : "";
    return { kind: "edit", filePath };
  }
  if (toolName === "Write" || toolName === "NotebookEdit") {
    const filePath =
      typeof input.file_path === "string" ? input.file_path : "";
    return { kind: "write", filePath };
  }
  if (toolName === "Read") {
    const filePath =
      typeof input.file_path === "string" ? input.file_path : "";
    return { kind: "read", filePath };
  }
  return { kind: "json", raw: toolInput };
}

// ── Decision builders ───────────────────────────────────────────

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

// ── Passthrough whitelist (TS mirror of Rust) ──────────────────
//
// Mirrors the Rust `agent::PASSTHROUGH_TOOLS` constant. When
// adding/removing a tool here, update both sides. The integration
// test (test-bubble.sh) cross-checks at runtime.

export const PASSTHROUGH_TOOLS = [
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TaskOutput",
] as const;

export type PassthroughTool = (typeof PASSTHROUGH_TOOLS)[number];

export function isPassthrough(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return (PASSTHROUGH_TOOLS as readonly string[]).includes(toolName);
}

// ── Permission suggestion normalization (TS mirror of Rust) ─────
//
// Mirrors `claude_code::normalize_permission_suggestions` so the TS
// side can normalize incoming suggestions independently if needed
// (e.g. for snapshot testing). For runtime, the Rust side already
// normalizes before emitting to the bubble.

export const MAX_PERMISSION_SUGGESTIONS = 20;

export function normalizePermissionSuggestions(
  raw: PermissionUpdateEntry[],
): PermissionUpdateEntry[] {
  const out: PermissionUpdateEntry[] = [];
  for (const entry of raw) {
    const last = out[out.length - 1];
    if (
      last &&
      last.type === "addRules" &&
      entry.type === "addRules" &&
      last.destination === entry.destination &&
      last.behavior === entry.behavior
    ) {
      // Merge: append rules to the last entry.
      last.rules.push(...entry.rules);
    } else {
      out.push(entry);
    }
    if (out.length >= MAX_PERMISSION_SUGGESTIONS) {
      break;
    }
  }
  return out;
}

// Re-export for downstream consumers
export type { PermissionRequest };