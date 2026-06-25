<script setup lang="ts">
// src/devtools/DevToolsApp.vue — DevTools parent SFC.
//
// INDEPENDENT of the robot window. The dev panel has its own XState
// DisplayStateResolver instance (via `useMachine`) and processes raw
// events directly (no round-trip through robot). The robot window is
// reduced to "animation source" — it still runs its own resolver to
// drive the sprite, but the dev panel no longer reads its state.
//
// This makes the dev panel the GROUND TRUTH reference. If you want
// to verify that the robot's resolver is working correctly, you can
// compare its sprite (animation) against the dev panel's computed
// state visually. If they diverge, the bug is in the robot.
//
// Per ADR-0006 §Decision, both instances use `useMachine(displayStateResolver,
// { input: { theme } })` — same machine definition, same Vue
// composable → behavior equivalence guarantee.
//
// See docs/adr/0005-dev-tools.md D11 for the broader dev-tools
// architecture.

import { ref, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, emit as tauriEmit } from "@tauri-apps/api/event";
import { useMachine } from "@xstate/vue";
import { displayStateResolver } from "../robot/display-state-resolver";
import { DEFAULT_THEME } from "../robot/display-state-constants";
import type { HookEvent, ThemeManifest } from "../robot/display-state-types";
import type { PermissionRequest } from "../types/permission";

import StateMachinePanel from "./panels/StateMachinePanel.vue";
import EventLogPanel from "./panels/EventLogPanel.vue";
import StoresPanel from "./panels/StoresPanel.vue";
import SyntheticFirePanel from "./panels/SyntheticFirePanel.vue";
import VisualDebugPanel from "./panels/VisualDebugPanel.vue";
import ThemeEditorPanel from "./panels/ThemeEditorPanel.vue";

// ── Local DisplayStateResolver (ground truth for dev panel) ───────
//
// Initializes with DEFAULT_THEME; on mount we fetch the real theme
// and send THEME_CHANGED so timings match the robot window.

const { snapshot: smSnapshot, send } = useMachine(displayStateResolver, {
  input: { theme: DEFAULT_THEME as unknown as ThemeManifest },
});

// `smSnapshot.value.context` is the live MachineSnapshot. Panel 1
// renders from this ref via a thin wrapper ref for type clarity.
const snapshot = ref(smSnapshot.value.context);
watch(
  smSnapshot,
  (s) => {
    snapshot.value = s.context;
  },
  { deep: false },
);

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
  send({ type: "AGENT_HOOK", event });
  await tauriEmit("devtools-synthetic-event", {
    event,
    synthetic: true,
    source: "devtools",
  });
}

// ── Reset (local resolver + broadcast to robot) ───────────────────

async function resetAll() {
  send({ type: "RESET" });
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

  // Fetch the active theme manifest so timings match the robot window.
  // `get_settings` returns the current theme id; `theme_load` reads
  // the manifest from disk on the Rust side.
  try {
    const settings = await invoke<{ theme_id?: string }>("get_settings");
    if (settings?.theme_id) {
      const theme = await invoke<ThemeManifest>("theme_load", {
        themeId: settings.theme_id,
      });
      send({ type: "THEME_CHANGED", theme });
    }
  } catch (err) {
    console.warn("[devtools] initial theme load failed:", err);
  }

  // Theme-change broadcasts from the robot window / settings → swap
  // local theme so timing-sensitive operations (sleep sequence,
  // auto-return) match.
  unsubscribers.push(
    await listen("theme-change", async (e) => {
      const themeId = (e.payload as { theme_id?: string })?.theme_id;
      if (!themeId) return;
      try {
        const theme = await invoke<ThemeManifest>("theme_load", {
          themeId,
        });
        send({ type: "THEME_CHANGED", theme });
      } catch (err) {
        console.warn("[devtools] theme_load on theme-change failed:", err);
      }
    }),
  );
  unsubscribers.push(
    await listen("theme-updated", async (e) => {
      const themeId = (e.payload as { theme?: string })?.theme;
      if (!themeId) return;
      try {
        const theme = await invoke<ThemeManifest>("theme_load", {
          themeId,
        });
        send({ type: "THEME_CHANGED", theme });
      } catch (err) {
        console.warn("[devtools] theme_load on theme-updated failed:", err);
      }
    }),
  );

  // Real events from HTTP server → feed local resolver + log.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const p = e.payload as HookEvent;
      send({ type: "AGENT_HOOK", event: p });
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

  // Synthetic events from dev panel form (received by both robot and
  // dev panel — robot drives sprite, dev panel logs it; the local
  // resolver was already fed by fireSynthetic before this emit, so
  // we only log here).
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
  // Reset broadcast (from any source — this panel, another dev
  // panel session, or a future trigger). Reset local resolver and log.
  unsubscribers.push(
    await listen("devtools-reset", () => {
      send({ type: "RESET" });
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
      <StoresPanel :pending="pending" />
      <SyntheticFirePanel :agents="agents" :fire-synthetic="fireSynthetic" />
      <ThemeEditorPanel />
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
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 1px;
  background: #313244;
}
.grid > section {
  background: #181825;
  overflow: auto;
}
</style>