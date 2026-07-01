// src/permission/registry-pure.ts — pure helpers used by both the
// runtime registry and the test-side re-export bundle. SideEffect
// classification (SideEffectRender + classifySideEffect) now lives
// solely in registry.ts — there is no parallel pure copy.
//
// These functions are re-exported via src/permission/__test__/index.ts
// (the uma-pet "module.exports.__test" pattern). Tests can import
// from __test__ without pulling in the full registry surface.

import type {
  PermissionDecision,
  PermissionRequest,
  PermissionUpdateEntry,
} from "../types/permission";

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