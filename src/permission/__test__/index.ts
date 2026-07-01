// src/permission/__test__/index.ts — pure-function re-exports for
// unit testing without Vue / Tauri runtime.
//
// Mirrors uma-pet's `module.exports.__test` convention. Tests should
// import from this file when they only need pure helpers; this avoids
// pulling in the full registry surface (which composes from these
// helpers but also references Vue / Tauri APIs).

export {
  classifySideEffect,
  buildPlanFeedbackDecision,
  buildDenyAndFocusDecision,
  isPassthrough,
  PASSTHROUGH_TOOLS,
  normalizePermissionSuggestions,
  MAX_PERMISSION_SUGGESTIONS,
  type SideEffectRender,
  type PassthroughTool,
} from "../registry-pure";

export {
  getBubblePolicy,
  clampSeconds,
  MAX_AUTO_CLOSE_SECONDS,
  type BubblePolicy,
  type BubblePolicySnapshot,
  type BubbleKind,
} from "../bubble-policy";