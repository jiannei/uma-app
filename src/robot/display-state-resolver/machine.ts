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
  states: {
    idle: {
      on: {
        AGENT_HOOK: [
          {
            guard: 'sessionEndedAndIsLast',
            target: 'sleeping',
            actions: 'clearSession',
          },
          {
            guard: 'sessionEnded',
            actions: 'clearSession',
          },
          {
            guard: 'toolFailed',
            target: 'oneShot.error',
            actions: ['ingestEvent', 'armErrorOneShot'],
          },
          {
            guard: 'isNotification',
            target: 'oneShot.notification',
            actions: ['ingestEvent', 'armNotificationOneShot'],
          },
          {
            guard: 'hasTwoOrMoreSubs',
            target: 'juggling',
            actions: 'ingestEvent',
          },
          {
            guard: 'hasExactlyOneSub',
            target: 'subagentGroove',
            actions: 'ingestEvent',
          },
          {
            guard: 'isUserPrompt',
            target: 'thinking',
            actions: 'ingestEvent',
          },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    thinking: {
      on: {
        AGENT_HOOK: [
          { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
          { guard: 'sessionEnded', actions: 'clearSession' },
          { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
          { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
          { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    working: {
      on: {
        AGENT_HOOK: [
          { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
          { guard: 'sessionEnded', actions: 'clearSession' },
          { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
          { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
          { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
          { guard: 'isUserPrompt', target: 'thinking', actions: 'ingestEvent' },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    building: {
      on: {
        AGENT_HOOK: [
          { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
          { guard: 'sessionEnded', actions: 'clearSession' },
          { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
          { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
          { guard: 'isSubagentToolStart', target: 'subagentGroove', actions: 'ingestEvent' },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    subagentGroove: {
      on: {
        AGENT_HOOK: [
          { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
          { guard: 'sessionEnded', actions: 'clearSession' },
          { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
          { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
          { guard: 'hasTwoOrMoreSubs', target: 'juggling', actions: 'ingestEvent' },
          { guard: 'isSubagentToolEnd', target: 'building', actions: 'ingestEvent' },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    juggling: {
      on: {
        AGENT_HOOK: [
          { guard: 'sessionEndedAndIsLast', target: 'sleeping', actions: 'clearSession' },
          { guard: 'sessionEnded', actions: 'clearSession' },
          { guard: 'toolFailed', target: 'oneShot.error', actions: ['ingestEvent', 'armErrorOneShot'] },
          { guard: 'isNotification', target: 'oneShot.notification', actions: ['ingestEvent', 'armNotificationOneShot'] },
          { guard: 'isSubagentToolEnd', target: 'subagentGroove', actions: 'ingestEvent' },
          { actions: 'ingestEvent' },
        ],
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    // ── Sleep sequence (CONTEXT.md → SleepSequence) ──────────
    yawning: {
      after: {
        yawnDuration: 'dozing',
      },
      on: {
        AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' },
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    dozing: {
      after: {
        deepSleepTimeout: 'collapsing',
      },
      on: {
        AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' },
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    collapsing: {
      after: {
        collapseDuration: 'sleeping',
      },
      on: {
        AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' },
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    sleeping: {
      on: {
        AGENT_HOOK: { target: 'waking', actions: 'ingestEvent' },
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    waking: {
      after: {
        wakeDuration: 'idle',
      },
      on: {
        RESET: { target: 'idle', actions: 'clearAll' },
        THEME_CHANGED: { actions: 'swapTheme' },
      },
    },
    // ── One-shot composite (CONTEXT.md → OneShotState, ADR-0007) ──
    oneShot: {
      initial: 'attention',
      states: {
        attention: {
          after: {
            attentionAutoReturn: {
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
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
        error: {
          after: {
            errorAutoReturn: {
              target: '#robot.idle',
              actions: ['clearOneShot', 'recomputeDisplay'],
            },
          },
          on: {
            AGENT_HOOK: [
              { guard: 'sessionEndedAndIsLast', target: '#robot.sleeping', actions: ['clearSession', 'clearOneShot'] },
              { guard: 'sessionEnded', actions: 'clearSession' },
              { actions: 'ingestEventSilent' },
            ],
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
        notification: {
          after: {
            notificationAutoReturn: {
              target: '#robot.idle',
              actions: ['clearOneShot', 'recomputeDisplay'],
            },
          },
          on: {
            AGENT_HOOK: [
              { guard: 'sessionEndedAndIsLast', target: '#robot.sleeping', actions: ['clearSession', 'clearOneShot'] },
              { guard: 'sessionEnded', actions: 'clearSession' },
              { actions: 'ingestEventSilent' },
            ],
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
      },
    },
  },
});