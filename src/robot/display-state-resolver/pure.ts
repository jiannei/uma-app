// src/robot/display-state-resolver/pure.ts — Pure helpers extracted from
// the XState machine definition. No XState imports; every function here
// is referentially transparent and unit-testable in isolation.
//
// See CONTEXT.md (DisplayStateResolver) for the domain vocabulary; the
// machine definition (machine.ts) consumes these helpers via the actions
// and guards inside `setup({...}).createMachine(...)`.

import { UNKNOWN_AGENT } from '../display-state-constants';
import type {
  CanonicalEventName,
  DisplayState,
  HookEvent,
  SessionEntry,
  SessionKey,
} from '../display-state-types';

/** Priority-ordered state walk; first hit wins. */
export const STATE_PRIORITY_ORDER: DisplayState[] = [
  'error',
  'notification',
  'attention',
  'juggling',
  'subagent-groove',
  'building',
  'thinking',
  'working',
  'carrying',
];

export function sessionKeyOf(event: HookEvent): SessionKey {
  const aid = event.agent || UNKNOWN_AGENT;
  return `${aid}:${event.session_id}`;
}

/**
 * Pure priority walk: given the current sessions map, return the highest-
 * priority DisplayState present, falling back to 'idle'.
 */
export function recomputeDisplayState(
  sessions: Record<SessionKey, SessionEntry>,
): DisplayState {
  const seen = new Set<DisplayState>();
  for (const entry of Object.values(sessions)) seen.add(entry.state);
  for (const s of STATE_PRIORITY_ORDER) {
    if (seen.has(s)) return s;
  }
  return 'idle';
}

/**
 * Base DisplayState for a canonical event name. Mirrors the table in
 * CONTEXT.md (Base DisplayState by canonical event); if you change this,
 * update that table too.
 */
export function deriveStateFromEvent(event: CanonicalEventName): DisplayState {
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

/**
 * Map an active-subagent count to its derived DisplayState. This is the
 * single source of truth for the count → state mapping, used by both the
 * ingest action (computeIngestUpdate) and the transition guards
 * (hasTwoOrMoreSubs / hasExactlyOneSub). The previous bug where a
 * ToolCallEnd at count==2 would erroneously bounce to 'juggling' (see
 * L188-192 in the prior 539-line file) becomes structurally impossible:
 * any future change to "what count means juggling" must be made here.
 */
export function subagentStateFor(count: number): DisplayState {
  if (count >= 2) return 'juggling';
  if (count === 1) return 'subagent-groove';
  return 'building';
}

/**
 * Minimal event shape ingest needs. Lets pure.ts stay free of the
 * machine-specific ResolverEvent union (which carries THEME_CHANGED and
 * RESET alongside AGENT_HOOK).
 */
export interface PureIngestEvent {
  type: 'AGENT_HOOK';
  event: HookEvent;
}

/**
 * Compute the updated sessions map and subagent counts for an AGENT_HOOK
 * event. Returns null for non-hook events (RESET, THEME_CHANGED) since
 * those don't touch per-session state. Pure: depends only on the supplied
 * sessions and activeSubagents maps; no clock or random.
 */
export function computeIngestUpdate(
  sessions: Record<SessionKey, SessionEntry>,
  activeSubagents: Record<SessionKey, number>,
  event: PureIngestEvent,
): { sessions: Record<SessionKey, SessionEntry>; activeSubagents: Record<SessionKey, number> } | null {
  const key = sessionKeyOf(event.event);
  const toolName = event.event.tool_name;
  // `subagent` is the agent-specific decision made by the adapter; the
  // canonical layer never inspects the tool name. See ADR-0008.
  const isSubagent = event.event.subagent === true;

  // Subagent counter delta
  let subagentCount = activeSubagents[key] ?? 0;
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
    sessionState = subagentStateFor(subagentCount);
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

  return {
    sessions: { ...sessions, [key]: entry },
    activeSubagents: { ...activeSubagents, [key]: subagentCount },
  };
}