<script setup lang="ts">
// src/devtools/DevToolsApp.vue — DevTools parent SFC.
//
// INDEPENDENT of the pet window. The dev panel has its own
// StateMachine instance and processes raw events directly (no
// round-trip through pet). The pet window is reduced to "animation
// source" — it still runs its own SM to drive the sprite, but the
// dev panel no longer reads its state.
//
// This makes the dev panel the GROUND TRUTH reference. If you want
// to verify that the pet's SM is working correctly, you can compare
// its sprite (animation) against the dev panel's computed state
// visually. If they diverge, the bug is in the pet.
//
// See docs/adr/0005-dev-tools.md D11 for the full architecture.

import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, emit as tauriEmit } from "@tauri-apps/api/event";
import { StateMachine } from "../pet/state-machine.js";
import type { HookEvent, StateMachineSnapshot as Snapshot, PermissionRequest } from "../pet/state-machine.js";

import StateMachinePanel from "./panels/StateMachinePanel.vue";
import EventLogPanel from "./panels/EventLogPanel.vue";
import StoresPanel from "./panels/StoresPanel.vue";
import SyntheticFirePanel from "./panels/SyntheticFirePanel.vue";
import VisualDebugPanel from "./panels/VisualDebugPanel.vue";

// ── Local state machine (ground truth for dev panel) ────────────
//
// Receives the same event stream as the pet (agent-hook-event +
// devtools-synthetic-event). Computes state independently. Panel 1
// shows this SM's snapshot.
const stateMachine = new StateMachine();
const EMPTY_SNAPSHOT: Snapshot = {
  sessions: new Map(),
  activeSubagents: new Map(),
  activeOneShot: null,
  displayState: "idle",
};
const snapshot = ref<Snapshot>(EMPTY_SNAPSHOT);

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

// ── Synthetic event fire ────────────────────────────────────────
//
// Feed the local SM directly (so Panel 1 updates without a round
// trip), and ALSO emit `devtools-synthetic-event` so the pet
// window's sprite reacts.
async function fireSynthetic(event: HookEvent) {
  stateMachine.processEvent(event);
  await tauriEmit("devtools-synthetic-event", {
    event,
    synthetic: true,
    source: "devtools",
  });
}

// ── Reset (local SM + broadcast to pet) ─────────────────────────

async function resetAll() {
  stateMachine.reset();
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

  // Local SM changes → update Panel 1.
  stateMachine.onChange(() => {
    snapshot.value = stateMachine.getSnapshot();
  });

  // Real events from HTTP server → feed local SM + log.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const p = e.payload as HookEvent;
      stateMachine.processEvent(p);
      pushEvent({
        timestamp: Date.now(),
        source: "http",
        synthetic: false,
        agent: p.agent ?? "",
        session_id: p.session_id ?? "",
        event_type: p.event_type ?? "",
        payload: p,
      });
    })
  );

  // Synthetic events from dev panel form (received by both pet and
  // dev panel — pet drives sprite, dev panel logs it; the local SM
  // was already fed by fireSynthetic before this emit, so we only
  // log here).
  unsubscribers.push(
    await listen("devtools-synthetic-event", (e) => {
      const env = e.payload as { event: HookEvent };
      const ev = env.event;
      pushEvent({
        timestamp: Date.now(),
        source: "devtools",
        synthetic: true,
        agent: ev.agent ?? "",
        session_id: ev.session_id ?? "",
        event_type: ev.event_type ?? "",
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

  // Reset broadcast (from any source — this panel, another dev
  // panel session, or a future trigger). Reset local SM and log.
  unsubscribers.push(
    await listen("devtools-reset", () => {
      stateMachine.reset();
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
      <span class="title">Uma DevTools</span>
      <button class="reset" @click="resetAll">Reset</button>
    </header>
    <main class="grid">
      <StateMachinePanel :snapshot="snapshot" />
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
