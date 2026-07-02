// src/permission/pure.ts — pure helpers for the permission layer.
//
// No imports from registry.ts or any Vue/Tauri runtime. Each helper is
// a referentially-transparent function (or constant) that mirrors a
// Rust-side concern. Kept separate from registry.ts so the
// kind-routing logic in registry.ts doesn't have to drag in the
// suggestion-normalization or passthrough helpers — and so tests
// that only need these helpers don't have to import the full
// registry surface.

import type { PermissionUpdateEntry } from "../types/permission";

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
