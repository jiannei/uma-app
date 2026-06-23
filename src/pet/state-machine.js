// src/pet/state-machine.js — State machine + subagent tracking
// Handles agent hook events and resolves to display state

// Agent event → internal state mapping (aligned with uma-pet)
const EVENT_TO_STATE = {
  SessionStart: 'idle',
  SessionEnd: 'sleeping',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PostToolUseFailure: 'error',
  Stop: 'attention',
  Notification: 'notification',
  PermissionRequest: 'notification',
  SubagentStart: 'working',
  SubagentStop: 'working',
};

// All supported display states (aligned with uma-pet)
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

// Priority order — higher number wins when multiple sessions are active
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

// Tools that count as subagent spawning
const SUBAGENT_TOOLS = new Set(['Task', 'Agent', 'task']);

class StateMachine {
  constructor() {
    this.sessions = new Map(); // sessionId → { state, lastEvent, toolName, subagentCount, timestamp }
    this.activeSubagents = new Map(); // sessionId → count of active subagents
    this.listeners = new Set();
  }

  /**
   * Process an incoming hook event from an agent
   * @param {object} event - { session_id, event_type, tool_name, ... }
   * @returns {string} - The new resolved display state
   */
  processEvent(event) {
    const { session_id, event_type, tool_name } = event;
    if (!session_id) {
      console.warn('[state] event missing session_id:', event);
      return this.getDisplayState();
    }

    const sid = String(session_id);
    const now = Date.now();
    let state = EVENT_TO_STATE[event_type];

    if (!state) {
      console.log(`[state] unknown event: ${event_type}`);
      return this.getDisplayState();
    }

    // Track subagent lifecycle (Task tool = Claude Code's subagent)
    if (SUBAGENT_TOOLS.has(tool_name)) {
      if (event_type === 'PreToolUse') {
        const count = this.activeSubagents.get(sid) || 0;
        this.activeSubagents.set(sid, count + 1);
        console.log(`[state] subagent spawned in ${sid}, count: ${count + 1}`);
      } else if (event_type === 'PostToolUse') {
        const count = this.activeSubagents.get(sid) || 0;
        if (count > 0) this.activeSubagents.set(sid, count - 1);
        console.log(`[state] subagent completed in ${sid}, count: ${count - 1}`);
      }
    }

    // Override state for Task tool (build/subagent states)
    if (SUBAGENT_TOOLS.has(tool_name) && (event_type === 'PreToolUse' || event_type === 'PostToolUse')) {
      const activeCount = this.activeSubagents.get(sid) || 0;
      if (activeCount >= 2) {
        state = 'juggling';
      } else if (activeCount === 1) {
        state = 'subagent-groove';
      } else {
        state = 'building';
      }
    }

    // Handle SubagentStart/SubagentStop events directly
    if (event_type === 'SubagentStart') {
      const count = this.activeSubagents.get(sid) || 0;
      this.activeSubagents.set(sid, count + 1);
      const activeCount = count + 1;
      state = activeCount >= 2 ? 'juggling' : activeCount === 1 ? 'subagent-groove' : 'working';
      console.log(`[state] subagent started in ${sid}, count: ${activeCount}`);
    } else if (event_type === 'SubagentStop') {
      const count = this.activeSubagents.get(sid) || 0;
      if (count > 0) this.activeSubagents.set(sid, count - 1);
      const activeCount = count - 1;
      state = activeCount >= 2 ? 'juggling' : activeCount === 1 ? 'subagent-groove' : 'working';
      console.log(`[state] subagent stopped in ${sid}, count: ${activeCount}`);
    }

    // Update session
    this.sessions.set(sid, {
      state,
      lastEvent: event_type,
      toolName: tool_name,
      subagentCount: this.activeSubagents.get(sid) || 0,
      timestamp: now,
    });

    const display = this.getDisplayState();
    this.notify({ sessionId: sid, state, display, event });
    return display;
  }

  /**
   * Resolve the highest-priority state across all sessions
   */
  getDisplayState() {
    if (this.sessions.size === 0) return 'idle';
    let best = 'idle';
    let bestPriority = 0;
    for (const { state } of this.sessions.values()) {
      const p = STATE_PRIORITY[state] || 0;
      if (p > bestPriority) {
        best = state;
        bestPriority = p;
      }
    }
    return best;
  }

  /**
   * Subscribe to state changes
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
   * Clean up stale sessions
   */
  cleanup(maxAgeMs = 5 * 60 * 1000) {
    const now = Date.now();
    let removed = 0;
    for (const [sid, session] of this.sessions.entries()) {
      if (now - session.timestamp > maxAgeMs) {
        this.sessions.delete(sid);
        this.activeSubagents.delete(sid);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[state] cleaned up ${removed} stale sessions`);
      this.notify({ sessionId: null, state: this.getDisplayState(), display: this.getDisplayState(), event: 'cleanup' });
    }
    return removed;
  }
}

// ES module exports
export { StateMachine, EVENT_TO_STATE, STATE_PRIORITY, ALL_STATES, SUBAGENT_TOOLS };

// CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateMachine, EVENT_TO_STATE, STATE_PRIORITY, ALL_STATES, SUBAGENT_TOOLS };
}