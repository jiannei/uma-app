// src/pet/state-machine.d.ts — Ambient type declarations for
// state-machine.js (which is plain JS — see CLAUDE.md tech stack
// note: ".js files in src/pet/ are not in tsconfig"). Keeps the
// dev-tools panel's TS strict mode happy without converting the
// runtime file to TS.

export interface HookEvent {
  session_id: string;
  event_type: string;
  tool_name?: string;
  agent?: string;
  success?: boolean;
  error?: string;
  prompt?: string;
  message?: string;
  model?: string;
  cwd?: string;
  transcript_path?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  reason?: string;
}

export interface SessionEntry {
  state: string;
  lastEvent: string;
  toolName?: string;
  subagentCount: number;
  timestamp: number;
  success?: boolean;
}

export interface StateMachineSnapshot {
  sessions: Map<string, Map<string, SessionEntry>>;
  activeSubagents: Map<string, Map<string, number>>;
  activeOneShot: { state: string; expiresAt: number } | null;
  displayState: string;
}

/// Mirrors the Rust `PermissionRequest` struct in
/// `src-tauri/src/agent.rs` (the wire shape after Serialize).
/// Used by the dev panel's StoresPanel to render pending entries.
export interface PermissionRequest {
  request_id: string;
  session_id: string;
  tool_name: string | null;
  tool_input: unknown;
  cwd: string | null;
  agent: string;
  agent_display_name: string;
}

export interface StateChangeEvent {
  agentId: string | null;
  sessionId: string | null;
  state: string;
  display: string;
  event: unknown;
}

export class StateMachine {
  constructor();
  processEvent(event: HookEvent): string;
  getDisplayState(): string;
  getSnapshot(): StateMachineSnapshot;
  reset(): void;
  cleanup(maxAgeMs?: number): number;
  onChange(listener: (e: StateChangeEvent) => void): () => void;
  getSubagentCount(aid: string, sid: string): number;
  setSubagentCount(aid: string, sid: string, count: number): void;
  putSession(aid: string, sid: string, entry: SessionEntry): void;
}

export const EVENT_TO_STATE: Record<string, string>;
export const STATE_PRIORITY: Record<string, number>;
export const ALL_STATES: string[];
export const SUBAGENT_TOOLS: Set<string>;
