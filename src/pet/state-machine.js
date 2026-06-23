// src/pet/state-machine.js — State machine + subagent tracking
// Implements ADR-0001 (canonical 8-event vocabulary) and the
// (agentId, sessionId) nested key structure (see CONTEXT.md → Session).
//
// Receives canonical `HookEvent`s from the HTTP server via the
// `agent-hook-event` Tauri event. Each event is normalized upstream
// by the agent's adapter — this file never sees agent-specific event
// names like `PreToolUse` or `Stop` (those are translated to
// `ToolCallStart` / `AgentTurnEnd` in `adapters/claude_code.rs`).

// ── Canonical 8-event vocabulary (ADR-0001) ─────────────────────

/// Agent event → internal display state. The keys here are the
/// canonical event names from CONTEXT.md (HookEvent), NOT agent-
/// specific event names. Adapters do the translation upstream.
const EVENT_TO_STATE = {
  SessionStart: 'idle',
  SessionEnd: 'sleeping',
  UserPromptSubmit: 'thinking',
  ToolCallStart: 'working',
  // Default for ToolCallEnd; overridden to 'error' if success=false
  // (see processEvent).
  ToolCallEnd: 'working',
  AgentTurnEnd: 'attention',
  Notification: 'notification',
  PermissionRequest: 'notification',
};

/// All supported display states. Themes map these to sprite files.
const ALL_STATES = [
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
];

/// Priority order — higher number wins when multiple sessions are
/// active. error > notification > attention > juggling > subagent-
/// groove > building > thinking > working > ... > idle.
const STATE_PRIORITY = {
  error: 100,
  notification: 90,
  attention: 70,
  juggling: 60,
  'subagent-groove': 55,
  building: 50,
  thinking: 40,
  working: 30,
  carrying: 25,
  sweeping: 20,
  waking: 15,
  sleeping: 5,
  idle: 0,
};

/// Tool names that count as a subagent spawn. Today every agent
/// uses the same name (the "Task" tool is the universal subagent
/// convention), but this stays a Set so a future agent with its
/// own vocabulary can extend it.
const SUBAGENT_TOOLS = new Set(['Task', 'Agent', 'task']);

/// Used when an incoming event has no `agent` field (e.g. legacy
/// payloads from before the adapter rewrite). Coalesce into a
/// single bucket so we don't lose sessions.
const UNKNOWN_AGENT = 'unknown';

class StateMachine {
  constructor() {
    // Nested map: agentId → sessionId → SessionEntry.
    // See CONTEXT.md (Session): the pet may observe multiple
    // sessions from multiple agents simultaneously, and a session
    // is uniquely identified by (host, agentId, sessionId). `host`
    // is always 'local' for the Tauri build, so we key on the
    // remaining two.
    //
    // SessionEntry: { state, lastEvent, toolName, subagentCount,
    //                 timestamp, success? }
    this.sessions = new Map();
    // Same nesting for the per-session active subagent count.
    this.activeSubagents = new Map();
    this.listeners = new Set();
  }

  /**
   * Process an incoming hook event from an agent.
   * @param {object} event - { session_id, event_type, tool_name, agent, success?, error? }
   * @returns {string} The new resolved display state
   */
  processEvent(event) {
    const { session_id, event_type, tool_name, success } = event;
    if (!session_id) {
      console.warn('[state] event missing session_id:', event);
      return this.getDisplayState();
    }

    const sid = String(session_id);
    const aid = event.agent || UNKNOWN_AGENT;
    const now = Date.now();
    let state = EVENT_TO_STATE[event_type];

    if (!state) {
      // SubagentStart / SubagentStop from older payloads, or any
      // future event the adapter hasn't taught us about. Log and
      // move on — the session's existing state stays in place.
      console.log(`[state] unknown canonical event: ${event_type}`);
      return this.getDisplayState();
    }

    // ToolCallEnd with success=false → 'error' state, regardless of
    // whether the tool was a subagent tool or not.
    if (event_type === 'ToolCallEnd' && success === false) {
      state = 'error';
    }

    // Subagent counting (per ADR-0001 subagent decision: count via
    // Task tool calls, NOT via a dedicated SubagentStart event).
    if (SUBAGENT_TOOLS.has(tool_name) &&
        (event_type === 'ToolCallStart' || event_type === 'ToolCallEnd')) {
      const count = this.getSubagentCount(aid, sid);
      if (event_type === 'ToolCallStart') {
        this.setSubagentCount(aid, sid, count + 1);
        console.log(`[state] subagent spawned in ${aid}/${sid}, count: ${count + 1}`);
      } else {
        // ToolCallEnd: only decrement if we have a positive count,
        // otherwise we'd go negative on a stray PostToolUse.
        if (count > 0) this.setSubagentCount(aid, sid, count - 1);
        console.log(`[state] subagent completed in ${aid}/${sid}, count: ${count - 1}`);
      }
      // Override state based on the (post-update) active count.
      const activeCount = this.getSubagentCount(aid, sid);
      if (activeCount >= 2) {
        state = 'juggling';
      } else if (activeCount === 1) {
        state = 'subagent-groove';
      } else {
        state = 'building';
      }
    }

    // Persist session entry under (agent, session).
    this.putSession(aid, sid, {
      state,
      lastEvent: event_type,
      toolName: tool_name,
      subagentCount: this.getSubagentCount(aid, sid),
      timestamp: now,
      success: event_type === 'ToolCallEnd' ? success : undefined,
    });

    const display = this.getDisplayState();
    this.notify({ agentId: aid, sessionId: sid, state, display, event });
    return display;
  }

  /**
   * Resolve the highest-priority state across all active sessions
   * (across all agents). The single pet animation shows the
   * loudest state.
   */
  getDisplayState() {
    if (this.sessions.size === 0) return 'idle';
    let best = 'idle';
    let bestPriority = 0;
    for (const byAgent of this.sessions.values()) {
      for (const { state } of byAgent.values()) {
        const p = STATE_PRIORITY[state] || 0;
        if (p > bestPriority) {
          best = state;
          bestPriority = p;
        }
      }
    }
    return best;
  }

  /**
   * Subscribe to state changes. Listener receives
   * `{ agentId, sessionId, state, display, event }` on every event.
   */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(payload) {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[state] listener error:', err);
      }
    }
  }

  /**
   * Remove sessions (and their subagent counters) older than
   * `maxAgeMs`. Walks both nesting levels.
   */
  cleanup(maxAgeMs = 5 * 60 * 1000) {
    const now = Date.now();
    let removed = 0;
    for (const [aid, bySession] of this.sessions.entries()) {
      for (const [sid, session] of bySession.entries()) {
        if (now - session.timestamp > maxAgeMs) {
          bySession.delete(sid);
          const counters = this.activeSubagents.get(aid);
          if (counters) counters.delete(sid);
          removed++;
        }
      }
      if (bySession.size === 0) {
        this.sessions.delete(aid);
        this.activeSubagents.delete(aid);
      }
    }
    if (removed > 0) {
      console.log(`[state] cleaned up ${removed} stale sessions`);
      this.notify({
        agentId: null,
        sessionId: null,
        state: this.getDisplayState(),
        display: this.getDisplayState(),
        event: 'cleanup',
      });
    }
    return removed;
  }

  // ── Nested-Map helpers (B1 key strategy) ─────────────────────

  getSubagentCount(aid, sid) {
    return this.activeSubagents.get(aid)?.get(sid) || 0;
  }

  setSubagentCount(aid, sid, count) {
    let bySession = this.activeSubagents.get(aid);
    if (!bySession) {
      bySession = new Map();
      this.activeSubagents.set(aid, bySession);
    }
    bySession.set(sid, count);
  }

  putSession(aid, sid, entry) {
    let bySession = this.sessions.get(aid);
    if (!bySession) {
      bySession = new Map();
      this.sessions.set(aid, bySession);
    }
    bySession.set(sid, entry);
  }
}

// ES module exports
export {
  StateMachine,
  EVENT_TO_STATE,
  STATE_PRIORITY,
  ALL_STATES,
  SUBAGENT_TOOLS,
};

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StateMachine,
    EVENT_TO_STATE,
    STATE_PRIORITY,
    ALL_STATES,
    SUBAGENT_TOOLS,
  };
}
