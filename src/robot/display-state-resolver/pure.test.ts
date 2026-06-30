// src/robot/display-state-resolver/pure.test.ts — Unit tests for the
// pure helpers. Run with `bun run test`. No XState involved.

import { describe, it, expect } from 'vitest';
import {
  STATE_PRIORITY_ORDER,
  sessionKeyOf,
  recomputeDisplayState,
  deriveStateFromEvent,
  subagentStateFor,
  computeIngestUpdate,
} from './pure';
import type { HookEvent, SessionEntry, SessionKey } from '../display-state-types';

// ── Test fixtures ───────────────────────────────────────────────

const agentHookEvent = (overrides: Partial<HookEvent> = {}): HookEvent => ({
  agent: 'claude-code',
  session_id: 'sess-1',
  event_type: 'ToolCallStart',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  tool_use_id: 'tu-1',
  ...overrides,
});

const sessionEntry = (overrides: Partial<SessionEntry> = {}): SessionEntry => ({
  state: 'idle',
  lastEvent: 'SessionStart',
  subagentCount: 0,
  timestamp: 0,
  ...overrides,
});

// ── deriveStateFromEvent (8 canonical cases) ─────────────────────

describe('deriveStateFromEvent', () => {
  it('SessionStart → idle', () => {
    expect(deriveStateFromEvent('SessionStart')).toBe('idle');
  });
  it('SessionEnd → sleeping', () => {
    expect(deriveStateFromEvent('SessionEnd')).toBe('sleeping');
  });
  it('UserPromptSubmit → thinking', () => {
    expect(deriveStateFromEvent('UserPromptSubmit')).toBe('thinking');
  });
  it('ToolCallStart → working', () => {
    expect(deriveStateFromEvent('ToolCallStart')).toBe('working');
  });
  it('ToolCallEnd → working', () => {
    expect(deriveStateFromEvent('ToolCallEnd')).toBe('working');
  });
  it('AgentTurnEnd → idle', () => {
    expect(deriveStateFromEvent('AgentTurnEnd')).toBe('idle');
  });
  it('Notification → notification', () => {
    expect(deriveStateFromEvent('Notification')).toBe('notification');
  });
  it('PermissionRequest → notification', () => {
    expect(deriveStateFromEvent('PermissionRequest')).toBe('notification');
  });
});

// ── subagentStateFor ─────────────────────────────────────────────

describe('subagentStateFor', () => {
  it('count=0 → building (no subagent running)', () => {
    expect(subagentStateFor(0)).toBe('building');
  });
  it('count=1 → subagent-groove', () => {
    expect(subagentStateFor(1)).toBe('subagent-groove');
  });
  it('count=2 → juggling', () => {
    expect(subagentStateFor(2)).toBe('juggling');
  });
  it('count=3 → juggling (>=2 branch)', () => {
    expect(subagentStateFor(3)).toBe('juggling');
  });
});

// ── recomputeDisplayState (priority walk) ────────────────────────

describe('recomputeDisplayState', () => {
  it('empty sessions → idle', () => {
    expect(recomputeDisplayState({})).toBe('idle');
  });

  it('single session at working → working', () => {
    const sessions: Record<SessionKey, SessionEntry> = {
      'claude-code:sess-1': sessionEntry({ state: 'working' }),
    };
    expect(recomputeDisplayState(sessions)).toBe('working');
  });

  it('multiple sessions: highest priority wins (error > notification > attention > working)', () => {
    const sessions: Record<SessionKey, SessionEntry> = {
      'claude-code:sess-1': sessionEntry({ state: 'working' }),
      'claude-code:sess-2': sessionEntry({ state: 'error' }),
      'claude-code:sess-3': sessionEntry({ state: 'notification' }),
    };
    expect(recomputeDisplayState(sessions)).toBe('error');
  });

  it('STATE_PRIORITY_ORDER starts with error', () => {
    expect(STATE_PRIORITY_ORDER[0]).toBe('error');
  });
});

// ── sessionKeyOf ─────────────────────────────────────────────────

describe('sessionKeyOf', () => {
  it('uses event.agent when present', () => {
    expect(sessionKeyOf(agentHookEvent({ agent: 'claude-code', session_id: 'abc' })))
      .toBe('claude-code:abc');
  });

  it('falls back to UNKNOWN_AGENT when event.agent is undefined', () => {
    const key = sessionKeyOf(agentHookEvent({ agent: undefined, session_id: 'abc' }));
    expect(key).toMatch(/:abc$/);
    expect(key).not.toBe('claude-code:abc');
  });
});

// ── computeIngestUpdate — subagent counter edges ─────────────────

describe('computeIngestUpdate — subagent counter', () => {
  it('ToolCallStart subagent:true increments from 0 → 1', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallStart',
      tool_name: 'Task',
      subagent: true,
      tool_use_id: 'tu-1',
    });
    const update = computeIngestUpdate({}, {}, { type: 'AGENT_HOOK', event });
    expect(update).not.toBeNull();
    expect(update!.activeSubagents['claude-code:sess-1']).toBe(1);
    // sessionState for subagent start at count==1 → subagent-groove
    expect(update!.sessions['claude-code:sess-1'].state).toBe('subagent-groove');
  });

  it('ToolCallStart subagent:true increments from 1 → 2', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallStart',
      tool_name: 'Task',
      subagent: true,
      tool_use_id: 'tu-2',
    });
    const update = computeIngestUpdate(
      {},
      { 'claude-code:sess-1': 1 },
      { type: 'AGENT_HOOK', event },
    );
    expect(update!.activeSubagents['claude-code:sess-1']).toBe(2);
    expect(update!.sessions['claude-code:sess-1'].state).toBe('juggling');
  });

  it('ToolCallEnd subagent:true decrements from 1 → 0', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallEnd',
      tool_name: 'Task',
      subagent: true,
      tool_use_id: 'tu-1',
      success: true,
    });
    const update = computeIngestUpdate(
      {},
      { 'claude-code:sess-1': 1 },
      { type: 'AGENT_HOOK', event },
    );
    expect(update!.activeSubagents['claude-code:sess-1']).toBe(0);
    expect(update!.sessions['claude-code:sess-1'].state).toBe('working');
  });

  it('ToolCallEnd at count==0 stays at 0 (no negative leak)', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallEnd',
      tool_name: 'Task',
      subagent: true,
      tool_use_id: 'tu-orphan',
      success: true,
    });
    const update = computeIngestUpdate(
      {},
      { 'claude-code:sess-1': 0 },
      { type: 'AGENT_HOOK', event },
    );
    expect(update!.activeSubagents['claude-code:sess-1']).toBe(0);
  });
});

// ── computeIngestUpdate — non-subagent edges ────────────────────

describe('computeIngestUpdate — non-subagent', () => {
  it('ToolCallEnd success=false → error state regardless of subagent flag', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallEnd',
      tool_name: 'Bash',
      success: false,
      tool_use_id: 'tu-1',
    });
    const update = computeIngestUpdate({}, {}, { type: 'AGENT_HOOK', event });
    expect(update!.sessions['claude-code:sess-1'].state).toBe('error');
  });

  it('plain ToolCallStart (subagent undefined) → working', () => {
    const event = agentHookEvent({
      event_type: 'ToolCallStart',
      tool_name: 'Bash',
      subagent: undefined,
      tool_use_id: 'tu-1',
    });
    const update = computeIngestUpdate({}, {}, { type: 'AGENT_HOOK', event });
    expect(update!.sessions['claude-code:sess-1'].state).toBe('working');
  });
});