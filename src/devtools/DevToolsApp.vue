<script setup lang="ts">
// src/devtools/DevToolsApp.vue — DevTools parent SFC.
//
// The dev panel no longer runs a parallel XState actor. Instead it
// calls pure.computeIngestUpdate / pure.recomputeDisplayState directly
// on local refs, sharing literally the same code path as the robot
// window. The dev panel is still the GROUND TRUTH reference: any bug
// in the pure helpers shows up here before the robot reacts.
//
// Why drop the parallel XState actor:
//   - Previously: useMachine(displayStateResolver) ran a second actor
//     instance with the same machine definition. Two actors diverging
//     on event ordering = phantom ground truth.
//   - Now: one pure module. The robot calls it via XState actions;
//     this panel calls it via sendEvent(). Same function, same result.
//
// See CONTEXT.md (DisplayStateResolver) for the domain vocabulary.

import { computed, ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, emit as tauriEmit } from "@tauri-apps/api/event";
import {
  computeIngestUpdate,
  recomputeDisplayState,
} from "../robot/display-state-resolver";
import type {
  HookEvent,
  MachineSnapshot as Snapshot,
  SessionEntry,
  SessionKey,
} from "../robot/display-state-types";
import type { PermissionRequest } from "../types/permission";
import Button from "@/components/Btn.vue";

import StateMachinePanel from "./panels/StateMachinePanel.vue";
import StoresPanel from "./panels/StoresPanel.vue";
import SyntheticFirePanel from "./panels/SyntheticFirePanel.vue";
import VisualDebugPanel from "./panels/VisualDebugPanel.vue";
import ThemeEditorPanel from "./panels/ThemeEditorPanel.vue";

// ── Local DisplayStateResolver state (pure-driven) ───────────────
//
// We hold the four MachineSnapshot fields as refs and update them
// via pure.computeIngestUpdate on each event. The snapshot the panels
// render is a `computed` derived from these refs.

const sessions = ref<Record<SessionKey, SessionEntry>>({});
const activeSubagents = ref<Record<SessionKey, number>>({});
const activeOneShot = ref<{ state: import("../robot/display-state-types").DisplayState; expiresAt: number } | null>(null);

const displayState = computed(() => recomputeDisplayState(sessions.value));

const snapshot = computed<Snapshot>(() => ({
  sessions: sessions.value,
  activeSubagents: activeSubagents.value,
  activeOneShot: activeOneShot.value,
  displayState: displayState.value,
}));

/** Apply an AGENT_HOOK event to local refs via the pure helper. */
function sendEvent(event: HookEvent) {
  const update = computeIngestUpdate(sessions.value, activeSubagents.value, {
    type: "AGENT_HOOK",
    event,
  });
  if (!update) return;
  sessions.value = update.sessions;
  activeSubagents.value = update.activeSubagents;
}

/** Clear all per-session state. activeOneShot stays; the resolver
 *  would re-arm it from a real one-shot event. */
function resetLocal() {
  sessions.value = {};
  activeSubagents.value = {};
  activeOneShot.value = null;
}

// ── Rust store snapshots (live) ─────────────────────────────────
//
// PendingStore: kept (one pending permission per request, with the
// full canonical PermissionRequest payload so the panel can render
// kind + per-kind fields).
//
// AlwaysAllowStore: REMOVED in ADR-0011 — CC owns session-scoped
// permission rules via destination: "session" entries; we no longer
// keep a parallel cache. See ADR-0003 (archived) for the previous
// per-(agent, session) HashSet<tool_name> shape.

interface PendingEntryView {
  requestId: string;
  agentId: string;
  request: PermissionRequest;
}
const pending = ref<PendingEntryView[]>([]);

async function refreshPending() {
  try {
    pending.value = await invoke<PendingEntryView[]>("devtools_get_pending");
  } catch (err) {
    console.warn("[devtools] devtools_get_pending failed:", err);
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
// Feed the local resolver directly (so Panel 1 updates without a
// round trip), and ALSO emit `devtools-synthetic-event` so the robot
// window's sprite reacts.
async function fireSynthetic(event: HookEvent) {
  sendEvent(event);
  await tauriEmit("devtools-synthetic-event", {
    event,
    synthetic: true,
    source: "devtools",
  });
}

// ── Reset (local resolver + broadcast to robot) ───────────────────

async function resetAll() {
  resetLocal();
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

  // Real events from HTTP server → feed local resolver (ground truth
  // state machine). Event log was removed — CLI output covers that.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const p = e.payload as HookEvent;
      sendEvent(p);
    })
  );

  // Rust store mutations → re-fetch.
  unsubscribers.push(
    await listen("devtools-pending-changed", () => {
      refreshPending();
    })
  );
  // Reset broadcast (from any source — this panel, another dev
  // panel session, or a future trigger). Reset local resolver.
  unsubscribers.push(
    await listen("devtools-reset", () => {
      resetLocal();
    })
  );
});

onUnmounted(() => {
  for (const u of unsubscribers) u();
  unsubscribers.length = 0;
});
</script>

<template>
  <div class="flex flex-col h-full bg-[var(--background)] text-[var(--foreground)]">
    <header class="flex items-center justify-between px-3 py-1.5 bg-[var(--background)] border-b border-[var(--border)]">
      <span class="font-semibold text-[12px] tracking-wider text-[var(--foreground)]">Uma DevTools</span>
      <Button variant="destructive" size="sm" @click="resetAll">
        Reset
      </Button>
    </header>
    <main class="flex-1 min-h-0 flex flex-wrap gap-px bg-[var(--border)]">
      <StateMachinePanel :snapshot="snapshot" class="flex-1 min-w-[280px] bg-[var(--card)] overflow-auto" />
      <VisualDebugPanel class="flex-1 min-w-[280px] overflow-auto" />
      <StoresPanel :pending="pending" class="flex-1 min-w-[280px] overflow-auto" />
      <SyntheticFirePanel :agents="agents" :fire-synthetic="fireSynthetic" class="flex-1 min-w-[280px] overflow-auto" />
      <ThemeEditorPanel class="flex-1 min-w-[280px] overflow-auto" />
    </main>
  </div>
</template>