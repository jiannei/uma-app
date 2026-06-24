// src/robot/display-state-resolver.ts — DisplayStateResolver as an XState v5 machine.
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
  SUBAGENT_TOOLS,
  UNKNOWN_AGENT,
} from './display-state-constants';
import type {
  CanonicalEventName,
  DisplayState,
  HookEvent,
  SessionEntry,
  SessionKey,
  ThemeManifest,
} from './display-state-types';

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

// ── Helpers ─────────────────────────────────────────────────────

function sessionKeyOf(event: HookEvent): SessionKey {
  const aid = event.agent || UNKNOWN_AGENT;
  return `${aid}:${event.session_id}`;
}

/** Priority-ordered state walk; first hit wins. */
const STATE_PRIORITY_ORDER: DisplayState[] = [
  'error',
  'notification',
  'attention',
  'juggling',
  'subagent-groove',
  'building',
  'thinking',
  'working',
  'carrying',
  'sweeping',
];

function recomputeDisplayState(
  sessions: Record<SessionKey, SessionEntry>,
): DisplayState {
  const seen = new Set<DisplayState>();
  for (const entry of Object.values(sessions)) seen.add(entry.state);
  for (const s of STATE_PRIORITY_ORDER) {
    if (seen.has(s)) return s;
  }
  return 'idle';
}

// ── Machine ─────────────────────────────────────────────────────

export const displayStateResolver = setup({
  types: {
    context: {} as ResolverContext,
    events: {} as ResolverEvent,
    input: {} as DisplayStateResolverInput,
  },
  guards: {
    sessionEnded: ({ event }) =>
      event.type === 'AGENT_HOOK' && event.event.event_type === 'SessionEnd',
    toolFailed: ({ event }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallEnd' &&
      event.event.success === false,
    isNotification: ({ event }) =>
      event.type === 'AGENT_HOOK' &&
      (event.event.event_type === 'Notification' ||
        event.event.event_type === 'PermissionRequest'),
    isUserPrompt: ({ event }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'UserPromptSubmit',
    isSubagentToolStart: ({ event }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallStart' &&
      typeof event.event.tool_name === 'string' &&
      SUBAGENT_TOOLS.has(event.event.tool_name),
    isSubagentToolEnd: ({ event }) =>
      event.type === 'AGENT_HOOK' &&
      event.event.event_type === 'ToolCallEnd' &&
      typeof event.event.tool_name === 'string' &&
      SUBAGENT_TOOLS.has(event.event.tool_name),
    /** Used by the juggling/subagent-groove/building dispatch on AGENT_HOOK. */
    hasTwoOrMoreSubs: ({ context, event }) => {
      if (event.type !== 'AGENT_HOOK') return false;
      const key = sessionKeyOf(event.event);
      const count = (context.activeSubagents[key] ?? 0) + (event.event.event_type === 'ToolCallStart' && SUBAGENT_TOOLS.has(event.event.tool_name ?? '') ? 1 : 0);
      return count >= 2;
    },
    hasExactlyOneSub: ({ context, event }) => {
      if (event.type !== 'AGENT_HOOK') return false;
      const key = sessionKeyOf(event.event);
      const count = context.activeSubagents[key] ?? 0;
      return count === 1;
    },
  },
  actions: {
    ingestEvent: assign(({ context, event }) => {
      if (event.type !== 'AGENT_HOOK') return {};
      const key = sessionKeyOf(event.event);
      const toolName = event.event.tool_name;
      const isSubagent = typeof toolName === 'string' && SUBAGENT_TOOLS.has(toolName);

      // Subagent counter delta
      let subagentCount = context.activeSubagents[key] ?? 0;
      if (isSubagent && event.event.event_type === 'ToolCallStart') {
        subagentCount = subagentCount + 1;
      } else if (
        isSubagent &&
        event.event.event_type === 'ToolCallEnd' &&
        subagentCount > 0
      ) {
        subagentCount = subagentCount - 1;
      }

      // Session state: error overrides; subagent count shapes; else by event.
      let sessionState: DisplayState = 'idle';
      if (event.event.event_type === 'ToolCallEnd' && event.event.success === false) {
        sessionState = 'error';
      } else if (isSubagent && event.event.event_type === 'ToolCallStart') {
        sessionState = subagentCount >= 2 ? 'juggling' : subagentCount === 1 ? 'subagent-groove' : 'building';
      } else if (isSubagent && event.event.event_type === 'ToolCallEnd') {
        sessionState = subagentCount >= 1 ? 'building' : 'working';
      } else {
        sessionState = deriveStateFromEvent(event.event.event_type as CanonicalEventName);
      }

      const entry: SessionEntry = {
        state: sessionState,
        lastEvent: event.event.event_type as CanonicalEventName,
        toolName,
        subagentCount,
        timestamp: Date.now(),
        success: event.event.event_type === 'ToolCallEnd' ? event.event.success : undefined,
      };

      const sessions = { ...context.sessions, [key]: entry };
      const activeSubagents = { ...context.activeSubagents, [key]: subagentCount };
      const displayState = recomputeDisplayState(sessions);

      return { sessions, activeSubagents, displayState };
    }),
    clearSession: assign(({ context, event }) => {
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
    swapTheme: assign(({ event }) =>
      event.type === 'THEME_CHANGED' ? { theme: event.theme } : {},
    ),
    armAttentionOneShot: assign(({ context }) => ({
      activeOneShot: {
        state: 'attention' as DisplayState,
        expiresAt:
          Date.now() + (context.theme.timings.autoReturn.attention ?? 4000),
      },
      displayState: 'attention' as DisplayState,
    })),
    armErrorOneShot: assign(({ context }) => ({
      activeOneShot: {
        state: 'error' as DisplayState,
        expiresAt: Date.now() + (context.theme.timings.autoReturn.error ?? 5000),
      },
      displayState: 'error' as DisplayState,
    })),
    armNotificationOneShot: assign(({ context }) => ({
      activeOneShot: {
        state: 'notification' as DisplayState,
        expiresAt:
          Date.now() + (context.theme.timings.autoReturn.notification ?? 5000),
      },
      displayState: 'notification' as DisplayState,
    })),
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
            guard: 'sessionEnded',
            target: 'sleeping',
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
            guard: 'isSubagentToolStart',
            target: 'building',
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
          { guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' },
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
          { guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' },
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
          { guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' },
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
          { guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' },
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
          { guard: 'sessionEnded', target: 'sleeping', actions: 'clearSession' },
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
    // ── One-shot composite (CONTEXT.md → OneShotState) ───────
    oneShot: {
      initial: 'attention',
      states: {
        attention: {
          after: {
            attentionAutoReturn: {
              target: '#robot.idle',
              actions: ['clearOneShot'],
            },
          },
          on: {
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
        error: {
          after: {
            errorAutoReturn: {
              target: '#robot.idle',
              actions: ['clearOneShot'],
            },
          },
          on: {
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
        notification: {
          after: {
            notificationAutoReturn: {
              target: '#robot.idle',
              actions: ['clearOneShot'],
            },
          },
          on: {
            RESET: { target: '#robot.idle', actions: 'clearAll' },
            THEME_CHANGED: { actions: 'swapTheme' },
          },
        },
      },
    },
  },
});

// ── Helpers exported for the panels & renderer ─────────────────

export { recomputeDisplayState, sessionKeyOf };

function deriveStateFromEvent(event: CanonicalEventName): DisplayState {
  switch (event) {
    case 'SessionStart':
      return 'idle';
    case 'SessionEnd':
      return 'sleeping';
    case 'UserPromptSubmit':
      return 'thinking';
    case 'ToolCallStart':
      return 'working';
    case 'ToolCallEnd':
      return 'working';
    case 'AgentTurnEnd':
      return 'idle';
    case 'Notification':
      return 'notification';
    case 'PermissionRequest':
      return 'notification';
  }
}