// src/robot/display-state-types.ts — Type definitions for the DisplayStateResolver.
//
// Single source of truth for types consumed by the XState machine,
// the robot Vue app, the dev panel, and any third-party consumer.
//
// See docs/adr/0006-adopt-xstate-for-display-state-resolver.md for
// the design rationale; see CONTEXT.md (DisplayStateResolver) for
// the domain vocabulary.

// ── Canonical 8-event vocabulary (ADR-0001) ─────────────────────

export type CanonicalEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'ToolCallStart'
  | 'ToolCallEnd'
  | 'AgentTurnEnd'
  | 'Notification'
  | 'PermissionRequest';

// ── Hook event payload ──────────────────────────────────────────

export interface HookEvent {
  session_id: string;
  event_type: string; // narrows to CanonicalEventName at the adapter layer
  tool_name?: string;
  agent?: string;
  success?: boolean;
  error?: string;
  /**
   * `true` when the adapter recognises this tool call as a subagent
   * spawn. The resolver reads this flag to drive the juggling /
   * subagent-groove / building display states; it never inspects
   * `tool_name` itself. See ADR-0008.
   */
  subagent?: boolean;
  prompt?: string;
  message?: string;
  model?: string;
  cwd?: string;
  transcript_path?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  reason?: string;
}

// ── Display state universe ──────────────────────────────────────

export type DisplayState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'building'
  | 'attention'
  | 'error'
  | 'notification'
  | 'sleeping'
  | 'waking'
  | 'carrying'
  | 'subagent-groove'
  | 'juggling'
  | 'yawning'
  | 'dozing'
  | 'collapsing';

// ── Session tracking ────────────────────────────────────────────

/** Composite key replaces nested Map<AgentId, Map<SessionId, ...>>. */
export type SessionKey = `${string}:${string}`;

export interface SessionEntry {
  state: DisplayState;
  lastEvent: CanonicalEventName;
  toolName?: string;
  subagentCount: number;
  timestamp: number;
  success?: boolean;
}

// ── Theme timings (consumed by the XState machine's `delays`) ──

export interface ThemeTimings {
  /** Minimum display time per state, used by reference to suppress flicker. */
  minDisplay: Partial<Record<DisplayState, number>>;
  /** Per-state auto-return duration for one-shot states. */
  autoReturn: Partial<Record<DisplayState, number>>;
  /** Sleep sequence step durations (CONTEXT.md → SleepSequence). */
  yawnDuration: number;
  wakeDuration: number;
  deepSleepTimeout: number;
  /** Reserved for the future "mouse-driven idle" feature; declared but not
   *  currently referenced by any transition (plan risk R6). */
  mouseIdleTimeout: number;
  mouseSleepTimeout: number;
  /** Optional collapse duration; defaults applied at delay-fn level. */
  collapseDuration?: number;
}

export interface ThemeManifest {
  name: string;
  timings: ThemeTimings;
  // Loose shape — the machine only reads `timings`; other fields
  // (states, hitBoxes, objectScale, etc.) are owned by ThemeManager.
  [k: string]: unknown;
}

// ── Public snapshot shape (dev panel Panel 1 reads this) ────────

export interface MachineSnapshot {
  sessions: Record<SessionKey, SessionEntry>;
  activeSubagents: Record<SessionKey, number>;
  activeOneShot: { state: DisplayState; expiresAt: number } | null;
  displayState: DisplayState;
}

// ── Permission wire shape (Rust mirror; consumed by StoresPanel) ─

// ── State-change event payload (renderer listener) ──────────────
// Matches the previous StateChangeEvent shape so `robot.html`'s
// `({ display }) => setDisplayState(display)` listener continues to
// work during the RobotRoot.vue migration.

export interface StateChangeEvent {
  agentId: string | null;
  sessionId: string | null;
  state: DisplayState;
  display: DisplayState;
  event: HookEvent | 'one-shot-expired' | 'cleanup' | 'reset' | 'theme-changed';
}