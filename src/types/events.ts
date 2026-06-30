// src/types/events.ts — Tauri event channel wire-string constants.
//
// Single source of truth lives at `docs/events.manifest.json`. This
// module mirrors it for TS use; the sibling `src-tauri/src/events.rs`
// mirrors it for Rust use. The anti-drift test in `events.test.ts`
// reads the manifest and asserts equality with the constants below.
//
// ADR-0019: scope = 8 prod + 4 dev + 2 deprecated (dead emit, pending
// remove). `tauri://move` is a Tauri built-in and is NOT in this
// registry.

export const EVENTS = {
  // ── Prod channels ── always present in both build profiles
  AGENT_HOOK: 'agent-hook-event',
  PERMISSION_REQUEST: 'permission-request',
  PERMISSION_TIMEOUT: 'permission-timeout',
  THEME_CHANGE: 'theme-change',
  THEME_UPDATED: 'theme-updated',
  DND_CHANGE: 'dnd-change',
  SOUND_CHANGE: 'sound-change',
  AUTO_START_CHANGE: 'auto-start-change',

  // ── Half-dead channels ── Rust still emits, TS has no listener.
  // Kept here so the `@deprecated` JSDoc is visible at every emit/listen
  // site. Stage B final PR removes both the constants and the dead Rust
  // emit sites.
  /** @deprecated no listener in TS; pending remove */
  LANGUAGE_CHANGE: 'language-change',
  /** @deprecated no listener in TS; pending remove */
  TOGGLE_MINI: 'toggle-mini',

  // ── Dev-only channels ── nested under DEV so a prod-side `listen()`
  // site cannot accidentally reference a dev channel without crossing
  // the namespace. Consumers should expose these via a `setupDevListeners()`
  // helper gated by `import.meta.env.DEV` so the whole block DCEs in
  // production builds.
  DEV: {
    PENDING_CHANGED: 'devtools-pending-changed',
    SYNTHETIC_EVENT: 'devtools-synthetic-event',
    RESET: 'devtools-reset',
    ROBOT_DEBUG_STYLE: 'devtools-robot-debug-style',
  },
} as const;

// Flat list of all prod wire strings (used by anti-drift test). Half-dead
// channels are included so the test catches any drift there too.
export const PROD_EVENT_WIRE_STRINGS: readonly string[] = [
  EVENTS.AGENT_HOOK,
  EVENTS.PERMISSION_REQUEST,
  EVENTS.PERMISSION_TIMEOUT,
  EVENTS.THEME_CHANGE,
  EVENTS.THEME_UPDATED,
  EVENTS.DND_CHANGE,
  EVENTS.SOUND_CHANGE,
  EVENTS.AUTO_START_CHANGE,
  EVENTS.LANGUAGE_CHANGE,
  EVENTS.TOGGLE_MINI,
];

export const DEV_EVENT_WIRE_STRINGS: readonly string[] = [
  EVENTS.DEV.PENDING_CHANGED,
  EVENTS.DEV.SYNTHETIC_EVENT,
  EVENTS.DEV.RESET,
  EVENTS.DEV.ROBOT_DEBUG_STYLE,
];
