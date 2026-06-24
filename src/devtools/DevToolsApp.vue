<script setup lang="ts">
// src/devtools/DevToolsApp.vue — DevTools parent SFC.
//
// Observes the pet window's state machine via the `pet-state-changed`
// Tauri event. Does NOT instantiate its own StateMachine — pet is
// the single source of truth, dev panel is a passive observer (see
// docs/adr/0005-dev-tools.md D9/D10). Also maintains a 1000-entry
// event-log ring buffer and Rust store snapshots, and passes data
// down to the 5 child panel SFCs.

import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, emit as tauriEmit } from "@tauri-apps/api/event";
import type { StateMachineSnapshot as Snapshot } from "../pet/state-machine.js";
import type { PermissionRequest } from "../pet/state-machine.js";

import StateMachinePanel from "./panels/StateMachinePanel.vue";
import EventLogPanel from "./panels/EventLogPanel.vue";
import StoresPanel from "./panels/StoresPanel.vue";
import SyntheticFirePanel from "./panels/SyntheticFirePanel.vue";
import VisualDebugPanel from "./panels/VisualDebugPanel.vue";

// ── Pet's state (observed, not owned) ───────────────────────────
//
// `petSnapshot` is the pet window's current StateMachineSnapshot,
// pushed by the pet on every change. Empty until the first event
// arrives (we don't have any local "synthesizing" copies anymore).
const EMPTY_SNAPSHOT: Snapshot = {
  sessions: new Map(),
  activeSubagents: new Map(),
  activeOneShot: null,
  displayState: "idle",
};
const petSnapshot = ref<Snapshot>(EMPTY_SNAPSHOT);

// Pet serializes snapshots as plain objects before emitting (Maps
// can lose structure across webviews). Rebuild Maps here so Panel 1
// can iterate them with the same code as the local SM API.
function deserializeSnapshot(data: any): Snapshot {
  const sessions = new Map<string, Map<string, any>>();
  for (const aid of Object.keys(data.sessions ?? {})) {
    const bySession = new Map<string, any>();
    for (const sid of Object.keys(data.sessions[aid])) {
      bySession.set(sid, data.sessions[aid][sid]);
    }
    sessions.set(aid, bySession);
  }
  const activeSubagents = new Map<string, Map<string, number>>();
  for (const aid of Object.keys(data.activeSubagents ?? {})) {
    const bySession = new Map<string, number>();
    for (const sid of Object.keys(data.activeSubagents[aid])) {
      bySession.set(sid, data.activeSubagents[aid][sid]);
    }
    activeSubagents.set(aid, bySession);
  }
  return {
    sessions,
    activeSubagents,
    activeOneShot: data.activeOneShot ?? null,
    displayState: data.displayState ?? "idle",
  };
}

// ── Event log ring buffer (1000 entries) ────────────────────────

interface EventLogEntry {
  timestamp: number;
  source: "http" | "devtools";
  synthetic: boolean;
  agent: string;
  session_id: string;
  event_type: string;
  payload: unknown;
}
const EVENT_LOG_MAX = 1000;
const eventLog = ref<EventLogEntry[]>([]);

function pushEvent(entry: EventLogEntry) {
  eventLog.value.push(entry);
  if (eventLog.value.length > EVENT_LOG_MAX) {
    eventLog.value.splice(0, eventLog.value.length - EVENT_LOG_MAX);
  }
}

// ── Rust store snapshots (live) ─────────────────────────────────

interface PendingEntryView {
  request_id: string;
  agent_id: string;
  request: PermissionRequest;
}
interface AlwaysAllowView {
  agent_id: string;
  session_id: string;
  tools: string[];
}
const pending = ref<PendingEntryView[]>([]);
const alwaysAllow = ref<AlwaysAllowView[]>([]);

async function refreshPending() {
  try {
    pending.value = await invoke<PendingEntryView[]>("devtools_get_pending");
  } catch (err) {
    console.warn("[devtools] devtools_get_pending failed:", err);
  }
}
async function refreshAlwaysAllow() {
  try {
    alwaysAllow.value = await invoke<AlwaysAllowView[]>("devtools_get_always_allow");
  } catch (err) {
    console.warn("[devtools] devtools_get_always_allow failed:", err);
  }
}

// ── Agents (for SyntheticFirePanel dropdown) ────────────────────

interface AgentInfo {
  id: string;
  display_name: string;
}
const agents = ref<AgentInfo[]>([]);

// ── dev_mode flag (no longer needed — dev panel always on) ─────

// Removed: dev_mode toggle, devMode ref, dev-mode-change listener.
// The dev panel always renders when this webview is mounted (which
// only happens in dev builds with the `dev-tools` feature, since
// the Rust side only creates the window under that gate).

// ── Synthetic event fire ────────────────────────────────────────

async function fireSynthetic(event: Record<string, unknown>) {
  await tauriEmit("devtools-synthetic-event", {
    event,
    synthetic: true,
    source: "devtools",
  });
}

// ── Reset (broadcast only — pet's state machine is the source) ──

async function resetAll() {
  eventLog.value = [];
  await tauriEmit("devtools-reset", {});
}

// ── Lifecycle: subscribe / unsubscribe ──────────────────────────

const unsubscribers: UnlistenFn[] = [];

onMounted(async () => {
  // Fetch agents list (for SyntheticFirePanel dropdown).
  try {
    agents.value = await invoke<AgentInfo[]>("list_agents");
  } catch (err) {
    console.warn("[devtools] list_agents failed:", err);
  }

  // Initial Rust store snapshots.
  await refreshPending();
  await refreshAlwaysAllow();

  // Pet's state — pushed by pet on every change. We don't have a
  // local StateMachine; the pet is the single source of truth.
  // Pet serializes Maps to plain objects for the IPC; rebuild here.
  unsubscribers.push(
    await listen("pet-state-changed", (e) => {
      try {
        console.log("[devtools] pet-state-changed raw payload:", e.payload);
        const snap = deserializeSnapshot(e.payload);
        console.log("[devtools] deserialized:", { display: snap.displayState, sessions: snap.sessions.size, sub: snap.activeSubagents.size });
        petSnapshot.value = snap;
      } catch (err) {
        console.warn("[devtools] pet-state-changed handler error:", err);
      }
    })
  );
  // Ask pet for its current state once (push-based updates keep us
  // in sync going forward, but we need a starting point).
  await tauriEmit("devtools-pet-state-request", {});

  // Real events from HTTP server → log only. Pet processes them
  // and will emit `pet-state-changed`; we just record the event
  // for the event-log panel.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const p = e.payload as Record<string, unknown>;
      pushEvent({
        timestamp: Date.now(),
        source: "http",
        synthetic: false,
        agent: (p.agent as string) ?? "",
        session_id: (p.session_id as string) ?? "",
        event_type: (p.event_type as string) ?? "",
        payload: p,
      });
    })
  );

  // Synthetic events from dev panel form → log with marker.
  // Pet processes them and re-emits pet-state-changed.
  unsubscribers.push(
    await listen("devtools-synthetic-event", (e) => {
      const env = e.payload as { event: Record<string, unknown> };
      const ev = env.event;
      pushEvent({
        timestamp: Date.now(),
        source: "devtools",
        synthetic: true,
        agent: (ev.agent as string) ?? "",
        session_id: (ev.session_id as string) ?? "",
        event_type: (ev.event_type as string) ?? "",
        payload: ev,
      });
    })
  );

  // Rust store mutations → re-fetch.
  unsubscribers.push(
    await listen("devtools-pending-changed", () => {
      refreshPending();
    })
  );
  unsubscribers.push(
    await listen("devtools-always-allow-changed", () => {
      refreshAlwaysAllow();
    })
  );

  // Reset broadcast (from this panel or another dev panel session).
  // Pet resets and re-emits pet-state-changed; we just clear our log.
  unsubscribers.push(
    await listen("devtools-reset", () => {
      eventLog.value = [];
    })
  );
});

onUnmounted(() => {
  for (const u of unsubscribers) u();
  unsubscribers.length = 0;
});
</script>

<template>
  <div class="devtools">
    <header>
      <span class="title">Clawd DevTools</span>
      <button class="reset" @click="resetAll">Reset</button>
    </header>
    <main class="grid">
      <StateMachinePanel :snapshot="petSnapshot" />
      <EventLogPanel :entries="eventLog" />
      <VisualDebugPanel />
      <StoresPanel :pending="pending" :always-allow="alwaysAllow" />
      <SyntheticFirePanel :agents="agents" :fire-synthetic="fireSynthetic" />
    </main>
  </div>
</template>

<style scoped>
.devtools {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #11111b;
  color: #cdd6f4;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #1e1e2e;
  border-bottom: 1px solid #313244;
}
header .title {
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.5px;
  color: #cdd6f4;
}
header .reset {
  background: #f38ba8;
  color: #1e1e2e;
  border: none;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
header .reset:hover { filter: brightness(0.9); }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background: #313244;
  flex: 1;
  min-height: 0;
}
</style>
