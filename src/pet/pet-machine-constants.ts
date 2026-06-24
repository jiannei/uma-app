// src/pet/pet-machine-constants.ts — Runtime constants for the DisplayStateResolver.
//
// Single source of truth for the constants consumed by the XState
// machine + theme manager + SyntheticFirePanel. Replaces the old
// hand-rolled duplicates previously scattered across the codebase.
//
// See docs/adr/0006-adopt-xstate-for-display-state-resolver.md.

import type { CanonicalEventName, DisplayState } from './pet-machine-types';

/** Every DisplayState the resolver can produce. Themes map these to sprites. */
export const ALL_STATES: readonly DisplayState[] = [
  'idle',
  'thinking',
  'working',
  'building',
  'attention',
  'error',
  'notification',
  'sleeping',
  'waking',
  'sweeping',
  'carrying',
  'subagent-groove',
  'juggling',
  'yawning',
  'dozing',
  'collapsing',
] as const;

/** Tool names that count as a subagent spawn (ADR-0001 subagent decision). */
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set([
  'Task',
  'Agent',
  'task',
]);

/** Canonical 8-event vocabulary (ADR-0001). */
export const CANONICAL_EVENTS: readonly CanonicalEventName[] = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'ToolCallStart',
  'ToolCallEnd',
  'AgentTurnEnd',
  'Notification',
  'PermissionRequest',
] as const;

/** Used when an incoming event has no `agent` field (e.g. legacy payloads). */
export const UNKNOWN_AGENT = 'unknown';

/**
 * Default theme timings used as the XState machine's initial input. The
 * pet window replaces this with the real theme on `pet-theme-change`;
 * the dev panel uses this until a theme-load resolves and a `THEME_CHANGED`
 * event catches it up.
 *
 * Values mirror uma theme.json — they're conservative defaults that
 * won't surprise when a real theme hasn't loaded yet. The dev panel
 * never auto-returns one-shots based on these values during normal
 * use; the values only matter for resolver init.
 */
export const DEFAULT_THEME = {
  name: 'default',
  timings: {
    minDisplay: {},
    autoReturn: {
      attention: 4000,
      error: 5000,
      notification: 5000,
      sweeping: 300000,
      carrying: 3000,
    },
    yawnDuration: 3000,
    wakeDuration: 1500,
    deepSleepTimeout: 600000,
    mouseIdleTimeout: 20000,
    mouseSleepTimeout: 60000,
  },
} as const;