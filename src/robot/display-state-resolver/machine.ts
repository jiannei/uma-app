// src/robot/display-state-resolver/machine.ts — DisplayStateResolver as
// an XState v5 machine. Pure helpers (subagentStateFor,
// recomputeDisplayState, etc.) live in pure.ts; this file consumes them
// via the `actions:` and `guards:` keys inside `setup({...})`.
//
// Implements ADR-0006 (adopt-xstate-for-display-state-resolver):
//   - delays read from context.theme.timings (evaluated at state-entry;
//     in-flight timers freeze the value they were scheduled with —
//     theme switches pick up on the NEXT state entry)
//   - assign-style session tracking in context (flat Record<SessionKey, ...>)
//   - aggregate-priority resolution via transition array order + guards
//   - sleep sequence: idle → yawning → dozing → collapsing → sleeping
//   - wake path: sleeping → waking → idle (no re-yawn)
//   - one-shots: attention / error / notification auto-return via
//     theme.timings.autoReturn[state]
//
// RESET and THEME_CHANGED are handled at the machine root (inherited
// by every state). Per-state configs focus on AGENT_HOOK via the
// `transitionsFor(role)` factory (6 active roles) and `oneShotState`
// factory (3 oneShot sub-states).
//
// See CONTEXT.md (DisplayStateResolver, SleepSequence, OneShotState)
// for the domain vocabulary; see the ADR for design trade-offs.

import { setup, assign } from 'xstate';
import {
  computeIngestUpdate,
  recomputeDisplayState,
  sessionKeyOf,
  subagentStateFor,
} from './pure';
import type {
  DisplayState,
  SessionEntry,
  SessionKey,
  ThemeManifest,
} from '../display-state-types';
import type { HookEvent } from '../display-state-types';

// ── Input (initial context) ─────────────────────────────────────

export interface DisplayStateResolverInput {
  theme: ThemeManifest;
}

// ── Context shape ───────────────────────────────────────────────

interface ResolverContext {
  sessions: Record<SessionKey, SessionEntry>;
  activeSubagents: Record<SessionKey, number>;
  theme: ThemeManifest;
  activeOneShot: { state: DisplayState; expiresAt: number } | null;
  /** Single source of truth for the resolver's output. */
  displayState: DisplayState;
}

// ── Event alphabet ──────────────────────────────────────────────

type ResolverEvent =
  | { type: 'AGENT_HOOK'; event: HookEvent }
  | { type: 'RESET' }
  | { type: 'THEME_CHANGED'; theme: ThemeManifest };

// ── Machine ─────────────────────────────────────────────────────

/**
 * Helper for the three arm*OneShot action bodies. Each one-shot
 * (attention / error / notification) sets `activeOneShot` with a wall-
 * clock expiry and pins `displayState` for the duration. The helper
 * lives outside `setup()` because XState v5's `assign()` type inference
 * is parameterised by the surrounding `setup({types:{...}})` block;
 * a factory wrapping `assign` would lose that context. The three
 * `arm*OneShot` action bodies below are therefore inlined rather than
 * generated. Action names are preserved so every transition site
 * (actions: ['ingestEvent', 'armErrorOneShot']) is unchanged.
 */
const armOneShotBody = (state: DisplayState, fallbackMs: number) =>
  ({ context }: { context: ResolverContext }) => ({
    activeOneShot: {
      state,
      expiresAt:
        Date.now() +
        (context.theme.timings.autoReturn[
          state as 'attention' | 'error' | 'notification'
        ] ?? fallbackMs),
    },
    displayState: state,
  });

// ── Active-role transition factory ──────────────────────────────
//
// The six "active" states (idle, thinking, working, building,
// subagentGroove, juggling) each carry an AGENT_HOOK transition
// array whose first 4 entries and last entry are identical across
// all six — only the role-specific middle entries differ. The
// factory centralises the common transitions and lets each state
// declare just its role-specific part.
//
// Order matters: XState tries guards top-down, first match wins.
// The common transitions (sessionEndedAndIsLast, sessionEnded,
// toolFailed, isNotification) must come first; role-specific
// transitions follow; the catch-all `ingestEvent` comes last.

type ActiveRole =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'building'
  | 'subagentGroove'
  | 'juggling';

const COMMON_AGENT_HOOK_TRANSITIONS = [
  { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
  { guard: 'sessionEnded', actions: 'clearSession' },
  { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
  { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
] as const;

const ROLE_SPECIFIC_TRANSITIONS = {
  idle: [
    { guard: 'hasTwoOrMoreSubs', target: 'juggling', actions: 'ingestEvent' },
    { guard: 'hasExactlyOneSub', target: 'subagentGroove', actions: 'ingestEvent' },
    { guard: 'isUserPrompt', target: 'thinking', actions: 'ingestEvent' },
  ],
  thinking: [
    { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
  ],
  working: [
    { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
    { guard: 'isUserPrompt', target: 'thinking', actions: 'ingestEvent' },
  ],
  building: [
    { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
  ],
  subagentGroove: [
    { guard: 'hasTwoOrMoreSubs', target: 'juggling', actions: 'ingestEvent' },
    { guard: 'isSubagentToolEnd', target: 'building', actions: 'ingestEvent' },
  ],
  juggling: [
    { guard: 'isSubagentToolEnd', target: 'subagentGroove', actions: 'ingestEvent' },
  ],
} as const;

const CATCH_ALL_TRANSITION = { actions: 'ingestEvent' } as const;

function transitionsFor(role: ActiveRole) {
  // `as any` bypasses XState's strict guard/action-name type check at
  // the factory boundary. The names are checked by virtue of being
  // defined in ROLE_SPECIFIC_TRANSITIONS (all literals from setup()'s
  // guards/actions tables); the factory just loses the narrow literal
  // types when spreading. Behaviorally equivalent to the inline form.
  return [
    ...COMMON_AGENT_HOOK_TRANSITIONS,
    ...ROLE_SPECIFIC_TRANSITIONS[role],
    CATCH_ALL_TRANSITION,
  ] as any;
}

// ── One-shot state factory ──────────────────────────────────────
//
// The three oneShot sub-states (attention, error, notification)
// are structurally identical: each waits for a per-state auto-
// return delay, then returns to idle. While waiting, SessionEnd
// clears the session (and exits to sleeping if it was the last);
// other events ingest silently so the one-shot display persists.

function oneShotState(delayName: string): any {
  // Return type is `any` because:
  //   - `after:` uses a computed delay name (`[delayName]`), which
  //     XState's strict type system rejects (it expects a literal
  //     delay name from setup()'s delays table).
  //   - `on.AGENT_HOOK` has the same guard/action-name widening as
  //     transitionsFor (see comment there).
  // All names below are defined in setup()'s tables; the factory
  // just loses the narrow literal types through extraction.
  return {
    after: {
      [delayName]: {
        target: '#robot.idle',
        actions: ['clearOneShot', 'recomputeDisplay'],
      },
    },
    on: {
      AGENT_HOOK: [
        // SessionEnd 在 one-shot 期间能正确收尾:跳 sleeping,清 session。
        { guard: 'sessionEndedAndIsLast', target: '#robot.sleeping', actions: ['clearSession', 'clearOneShot'] },
        { guard: 'sessionEnded', actions: 'clearSession' },
        // 其它事件:静默 ingest,one-shot 显示保持,计时器继续。
        { actions: 'ingestEventSilent' },
      ],
    },
  };
}

export const displayStateResolver = setup({
  types: {
    context: {} as ResolverContext,
    events: {} as ResolverEvent,
    input: {} as DisplayStateResolverInput,
  },
  guards: {
    sessionEnded: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' && event.event.event_type === 'SessionEnd'),
    /**
     * True when the incoming SessionEnd is also the last active session
     * — after clearing, `sessions` would be empty, so the resolver has
     * nothing left to display and should enter the sleep sequence.
     * For multi-session scenarios, individual SessionEnd events fall
     * through to the second-pass `sessionEnded` transition which only
     * clears the entry without leaving the current state. See CONTEXT.md
     * (SleepSequence) and ADR-0009 / follow-up (idleToSleepDelay).
     */
    sessionEndedAndIsLast: (({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return false;
      if (event.event.event_type !== 'SessionEnd') return false;
      return Object.keys(context.sessions).length === 1;
    }),
    toolFailed: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallEnd' &&
      event.event.success === false),
    isNotification: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' &&
      (event.event.event_type === 'Notification' ||
        event.event.event_type === 'PermissionRequest')),
    isUserPrompt: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'UserPromptSubmit'),
    isSubagentToolStart: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallStart' &&
      event.event.subagent === true),
    isSubagentToolEnd: (({ event }: { event: ResolverEvent }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallEnd' &&
      event.event.subagent === true),
    /**
     * Subagent count guards. Both only fire on `ToolCallStart` events
     * with `subagent: true` — that's the only event type where the
     * resolver would increment the subagent counter. ToolCallEnd and
     * other events fall through to the catch-all `ingestEvent` action,
     * which recomputes the display state from the updated `sessions`
     * map. The previous bug where a ToolCallEnd at `currentCount == 2`
     * would erroneously match `hasTwoOrMoreSubs` (the +1 only applied
     * to starts) is now structurally prevented: the count → state rule
     * lives in subagentStateFor, shared by both the action and the
     * guards, so a count change cannot drift between them.
     */
    hasTwoOrMoreSubs: (({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return false;
      if (event.event.event_type !== 'ToolCallStart') return false;
      if (event.event.subagent !== true) return false;
      const current = context.activeSubagents[sessionKeyOf(event.event)] ?? 0;
      return subagentStateFor(current + 1) === 'juggling';
    }),
    hasExactlyOneSub: (({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return false;
      if (event.event.event_type !== 'ToolCallStart') return false;
      if (event.event.subagent !== true) return false;
      const current = context.activeSubagents[sessionKeyOf(event.event)] ?? 0;
      return subagentStateFor(current + 1) === 'subagent-groove';
    }),
  },
  actions: {
    ingestEvent: assign(({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return {};
      const update = computeIngestUpdate(context.sessions, context.activeSubagents, event);
      if (!update) return {};
      return { ...update, displayState: recomputeDisplayState(update.sessions) };
    }),
    /**
     * OneShot 期间使用:更新 sessions/activeSubagents 但不动 displayState/activeOneShot,
     * 让当前 one-shot 显示继续。SessionEnd 例外——见 oneShot.* 状态里的转移。
     */
    ingestEventSilent: assign(({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return {};
      const update = computeIngestUpdate(context.sessions, context.activeSubagents, event);
      return update ?? {};
    }),
    /** 在 one-shot 退出或外部显式刷新时,把 displayState 同步到当前 sessions 的聚合结果。 */
    recomputeDisplay: assign(({ context }: { context: ResolverContext }) => ({
      displayState: recomputeDisplayState(context.sessions),
    })),
    clearSession: assign(({ context, event }: { context: ResolverContext; event: ResolverEvent }) => {
      if (event.type !== 'AGENT_HOOK') return {};
      const key = sessionKeyOf(event.event);
      if (!(key in context.sessions)) return {};
      const { [key]: _removed, ...sessions } = context.sessions;
      const { [key]: _count, ...activeSubagents } = context.activeSubagents;
      return { sessions, activeSubagents, displayState: recomputeDisplayState(sessions) };
    }),
    clearAll: assign(() => ({
      sessions: {} as Record<SessionKey, SessionEntry>,
      activeSubagents: {} as Record<SessionKey, number>,
      activeOneShot: null,
      displayState: 'idle' as DisplayState,
    })),
    swapTheme: assign(({ event }: { event: ResolverEvent }) =>
      event.type === 'THEME_CHANGED' ? { theme: event.theme } : {},
    ),
    armAttentionOneShot: assign(armOneShotBody('attention', 4000)),
    armErrorOneShot: assign(armOneShotBody('error', 5000)),
    armNotificationOneShot: assign(armOneShotBody('notification', 5000)),
    clearOneShot: assign(() => ({
      activeOneShot: null,
    })),
  },
  delays: {
    // Sleep sequence (CONTEXT.md → SleepSequence)
    yawnDuration: ({ context }) => context.theme.timings.yawnDuration,
    wakeDuration: ({ context }) => context.theme.timings.wakeDuration,
    deepSleepTimeout: ({ context }) => context.theme.timings.deepSleepTimeout,
    collapseDuration: ({ context }) =>
      context.theme.timings.collapseDuration ?? 1500,

    // One-shot auto-return (CONTEXT.md → OneShotState)
    attentionAutoReturn: ({ context }) =>
      context.theme.timings.autoReturn.attention ?? 4000,
    errorAutoReturn: ({ context }) =>
      context.theme.timings.autoReturn.error ?? 5000,
    notificationAutoReturn: ({ context }) =>
      context.theme.timings.autoReturn.notification ?? 5000,
  },
}).createMachine({
  id: 'robot',
  context: ({ input }) => ({
    sessions: {},
    activeSubagents: {},
    theme: input.theme,
    activeOneShot: null,
    displayState: 'idle',
  }),
  initial: 'idle',
  // RESET + THEME_CHANGED are handled uniformly across every state
  // (sleep sequence, active roles, and oneShot). Hoisting to the
  // machine root removes ~24 lines of per-state duplication; any
  // future state that needs different behaviour for these events
  // can override at the state level.
  on: {
    RESET: { target: 'idle', actions: 'clearAll' },
    THEME_CHANGED: { actions: 'swapTheme' },
  },
  states: {
    // ── Active roles ────────────────────────────────────────────
    // Each state declares only its role-specific AGENT_HOOK
    // transitions via `transitionsFor(role)`. The 4 common
    // transitions (sessionEndedAndIsLast, sessionEnded, toolFailed,
    // isNotification) and the catch-all `ingestEvent` are provided
    // by the factory. RESET/THEME_CHANGED inherited from root.
    idle:            { on: { AGENT_HOOK: transitionsFor('idle') } },
    thinking:        { on: { AGENT_HOOK: transitionsFor('thinking') } },
    working:         { on: { AGENT_HOOK: transitionsFor('working') } },
    building:        { on: { AGENT_HOOK: transitionsFor('building') } },
    subagentGroove:  { on: { AGENT_HOOK: transitionsFor('subagentGroove') } },
    juggling:        { on: { AGENT_HOOK: transitionsFor('juggling') } },

    // ── Sleep sequence (CONTEXT.md → SleepSequence) ─────────────
    yawning: {
      after: { yawnDuration: 'dozing' },
      on: { AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' } },
    },
    dozing: {
      after: { deepSleepTimeout: 'collapsing' },
      on: { AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' } },
    },
    collapsing: {
      after: { collapseDuration: 'sleeping' },
      on: { AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' } },
    },
    sleeping: {
      on: { AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' } },
    },
    waking: {
      after: { wakeDuration: 'idle' },
    },

    // ── One-shot composite (CONTEXT.md → OneShotState, ADR-0007) ─
    // Three structurally-identical sub-states, parameterised by
    // the auto-return delay name. RESET/THEME_CHANGED inherited
    // from root.
    oneShot: {
      initial: 'attention',
      states: {
        attention:    oneShotState('attentionAutoReturn'),
        error:        oneShotState('errorAutoReturn'),
        notification: oneShotState('notificationAutoReturn'),
      },
    },
  },
});