// src/permission/__test__/index.ts — pure-function re-exports for
// unit testing without Vue / Tauri runtime.
//
// Mirrors uma-pet's `module.exports.__test` convention. Tests should
// import from this file when they only need pure helpers; this avoids
// pulling in the full registry surface (which composes from these
// helpers but also references Vue / Tauri APIs).
//
// classifySideEffect + SideEffectRender now live in registry.ts (the
// parallel pure copy was deleted in Phase 2 to remove drift); the
// passthrough / suggestion normalization helpers still live in
// registry-pure.ts. We re-export both sources so tests can import
// any pure helper from this single entry.

export {
  classifySideEffect,
  type SideEffectRender,
} from "../registry";

export {
  buildPlanFeedbackDecision,
  buildDenyAndFocusDecision,
  isPassthrough,
  PASSTHROUGH_TOOLS,
  normalizePermissionSuggestions,
  MAX_PERMISSION_SUGGESTIONS,
  type PassthroughTool,
} from "../registry-pure";